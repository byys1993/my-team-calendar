import { matchDateKey, matchSortTime, matchTimeLabel, dateLabel, daysBetween, toDateKey } from "@/components/time";
import { INTL_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { fmt, MESSAGES } from "@/i18n";
import { formatLabel, formatTitle } from "@/i18n/format";
import { isTimeZone, unsubscribeSig, type NotifyMode, type SelectionItem } from "@/lib/auth/core";
import type { Db } from "@/lib/db";
import { getCatalog, getMatchesForTeams, type Catalog, type ScheduleMatch } from "@/lib/schedule";

// 경기 알림 메일. 매시간(일정 수집 직후) 불려서, 각자의 시간대에서 정한 시각이 지난 사람에게
// 오늘(매일) 또는 오늘부터 7일(매주 월요일) 경기를 보낸다. 같은 날 두 번 보내지 않고, 경기가 없으면 보내지 않는다.

export const DEFAULT_TZ = "Asia/Seoul";
// Resend 무료 플랜은 하루 100통 (로그인 코드 메일 포함). 한 번 실행에 이만큼만 보내고 나머지는 다음 시간에 보낸다.
export const MAX_PER_RUN = 80;

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  unsubscribeUrl: string;
}

export type Sender = (emails: OutgoingEmail[]) => Promise<void>;

interface Row {
  id: string;
  email: string;
  locale: string | null;
  time_zone: string | null;
  last_tz: string | null;
  selections: SelectionItem[];
  notify_mode: NotifyMode;
  notify_hour: number;
  last_notified_on: string | null;
}

const hourIn = (now: Date, tz: string) =>
  Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));

// 오늘(그 사람 시간대) 메일을 보낼 차례인지
export function isDue(
  u: { notifyMode: NotifyMode; notifyHour: number; lastNotifiedOn: string | null },
  now: Date,
  tz: string,
): boolean {
  if (u.notifyMode === "off") return false;
  const today = toDateKey(now, tz);
  if (u.lastNotifiedOn && u.lastNotifiedOn >= today) return false;
  if (hourIn(now, tz) < u.notifyHour) return false;
  // 매주 알림은 월요일에만 (그날 놓치면 다음 주)
  if (u.notifyMode === "weekly" && new Date(`${today}T00:00:00Z`).getUTCDay() !== 1) return false;
  return true;
}

// 알림에 넣을 경기: 매일은 오늘, 매주는 오늘부터 7일. 취소 경기는 뺀다.
export function pickMatches(matches: ScheduleMatch[], mode: NotifyMode, now: Date, tz: string): ScheduleMatch[] {
  const today = toDateKey(now, tz);
  const days = mode === "weekly" ? 7 : 1;
  return matches
    .filter((m) => m.status !== "cancelled")
    .filter((m) => {
      const d = daysBetween(today, matchDateKey(m, tz));
      return d >= 0 && d < days;
    })
    .sort((a, b) => matchSortTime(a) - matchSortTime(b));
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function composeEmail(opts: {
  to: string;
  locale: Locale;
  mode: Exclude<NotifyMode, "off">;
  tz: string;
  now: Date;
  matches: ScheduleMatch[];
  catalog: Catalog;
  siteUrl: string;
  unsubscribeUrl: string;
}): OutgoingEmail {
  const { locale, mode, tz, now, matches, catalog, siteUrl, unsubscribeUrl } = opts;
  const m = MESSAGES[locale];
  const intl = INTL_LOCALE[locale];
  const today = toDateKey(now, tz);
  const compName = new Map(catalog.competitions.map((c) => [c.slug, c.name]));
  const label = (s: string) => formatLabel(s, m) ?? s;

  // 날짜별로 묶는다 (매일 알림은 한 묶음)
  const byDay = new Map<string, string[]>();
  for (const x of matches) {
    const key = matchDateKey(x, tz);
    const who = x.title && !x.away ? formatTitle(x.title, m, locale)! : `${label(x.homeLabel)} ${m.match.vs} ${label(x.awayLabel)}`;
    const extra = [compName.get(x.competition), formatLabel(x.roundLabel, m)].filter(Boolean).join(" · ");
    const note = x.status !== "scheduled" && x.status !== "time_tbd" ? ` (${m.status[x.status]})` : "";
    const tv = x.broadcast ? `  📺 ${x.broadcast}` : "";
    const line = `${matchTimeLabel(x, intl, m.match.timeTbd, tz)}  ${who}${note}${extra ? `  —  ${extra}` : ""}${tv}`;
    byDay.set(key, [...(byDay.get(key) ?? []), line]);
  }

  const date = dateLabel(today, intl);
  const subject = `${fmt(mode === "daily" ? m.notify.subjectDaily : m.notify.subjectWeekly, { n: matches.length, date })} · ${m.app.title}`;
  const intro = mode === "daily" ? m.notify.introDaily : m.notify.introWeekly;
  const tzText = fmt(m.notify.timesIn, { tz: tz.replace(/_/g, " ") });

  const textDays = [...byDay].map(([key, lines]) => `[${dateLabel(key, intl)}]\n${lines.join("\n")}`);
  const text = [intro, "", ...textDays, "", tzText, `${m.notify.open}: ${siteUrl}`, "", m.notify.footer, `${m.notify.unsubscribe}: ${unsubscribeUrl}`].join("\n");

  const dir = locale === "ar" ? "rtl" : "ltr";
  const htmlDays = [...byDay]
    .map(
      ([key, lines]) =>
        `<h3 style="margin:18px 0 6px;font-size:15px">${escapeHtml(dateLabel(key, intl))}</h3>` +
        `<ul style="margin:0;padding-inline-start:18px">${lines.map((l) => `<li style="margin:4px 0">${escapeHtml(l)}</li>`).join("")}</ul>`,
    )
    .join("");
  const html = `<div dir="${dir}" style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#111">
<p>${escapeHtml(intro)}</p>${htmlDays}
<p style="color:#666;font-size:13px;margin-top:16px">${escapeHtml(tzText)}</p>
<p><a href="${escapeHtml(siteUrl)}">${escapeHtml(m.notify.open)}</a></p>
<hr style="border:none;border-top:1px solid #ddd;margin:20px 0 10px">
<p style="color:#888;font-size:12px">${escapeHtml(m.notify.footer)}<br><a href="${escapeHtml(unsubscribeUrl)}" style="color:#888">${escapeHtml(m.notify.unsubscribe)}</a></p>
</div>`;
  return { to: opts.to, subject, text, html, unsubscribeUrl };
}

export interface NotifyResult {
  checked: number;
  sent: number;
  empty: number; // 경기가 없어 보내지 않은 사람
  deferred: number; // 이번 실행 한도를 넘어 다음으로 미룬 사람
}

export async function runNotifications(
  db: Db,
  send: Sender,
  opts: { now?: Date; siteUrl: string; maxPerRun?: number },
): Promise<NotifyResult> {
  const now = opts.now ?? new Date();
  const max = opts.maxPerRun ?? MAX_PER_RUN;
  const rows = await db.query<Row>(
    `select id, email, locale, time_zone, last_tz, selections, notify_mode, notify_hour,
       to_char(last_notified_on, 'YYYY-MM-DD') as last_notified_on
     from app_user where notify_mode <> 'off' order by id`,
  );
  const catalogs = new Map<Locale, Catalog>();
  const result: NotifyResult = { checked: rows.length, sent: 0, empty: 0, deferred: 0 };
  // prev: 읽었을 때의 '마지막 알림 날짜' (선점할 때 그 사이 다른 곳이 먼저 보냈는지 확인용)
  const outgoing: { email: OutgoingEmail; userId: string; today: string; prev: string | null }[] = [];
  const emptyDone: { userId: string; today: string }[] = [];

  for (const r of rows) {
    const tz = [r.time_zone, r.last_tz].find(isTimeZone) ?? DEFAULT_TZ;
    if (!isDue({ notifyMode: r.notify_mode, notifyHour: r.notify_hour, lastNotifiedOn: r.last_notified_on }, now, tz)) continue;
    const today = toDateKey(now, tz);
    const slugs = (r.selections ?? []).filter((s) => s.enabled).map((s) => s.slug);
    const locale: Locale = isLocale(r.locale) ? r.locale : "ko";
    const matches = pickMatches(await getMatchesForTeams(db, slugs, locale), r.notify_mode, now, tz);
    if (matches.length === 0) {
      emptyDone.push({ userId: r.id, today });
      continue;
    }
    if (outgoing.length >= max) {
      result.deferred++;
      continue;
    }
    if (!catalogs.has(locale)) catalogs.set(locale, await getCatalog(db, locale));
    const unsubscribeUrl = `${opts.siteUrl}/unsubscribe?u=${r.id}&s=${unsubscribeSig(r.id)}`;
    outgoing.push({
      userId: r.id,
      today,
      prev: r.last_notified_on,
      email: composeEmail({
        to: r.email,
        locale,
        mode: r.notify_mode as Exclude<NotifyMode, "off">,
        tz,
        now,
        matches,
        catalog: catalogs.get(locale)!,
        siteUrl: opts.siteUrl,
        unsubscribeUrl,
      }),
    });
  }

  const mark = (list: { userId: string; today: string }[]) =>
    list.length
      ? db.query(
          `update app_user u set last_notified_on = x.today::date
           from jsonb_to_recordset($1::text::jsonb) as x(id uuid, today text) where u.id = x.id`,
          [JSON.stringify(list.map((x) => ({ id: x.userId, today: x.today })))],
        )
      : Promise.resolve();

  await mark(emptyDone);
  result.empty = emptyDone.length;
  // Resend 배치는 한 번에 100통까지.
  // 여러 곳(GitHub Actions·Cloudflare)이 동시에 불러도 한 사람에게 하루 한 통만 가도록,
  // 보내기 전에 '오늘 보냄'으로 먼저 표시(선점)하고 선점에 성공한 사람에게만 보낸다. 발송이 실패하면 표시를 되돌린다.
  for (let i = 0; i < outgoing.length; i += 100) {
    const chunk = outgoing.slice(i, i + 100);
    const claimed = await db.query<{ id: string; prev: string | null }>(
      `update app_user u set last_notified_on = x.today::date
       from jsonb_to_recordset($1::text::jsonb) as x(id uuid, today text, prev text)
       where u.id = x.id and u.last_notified_on is not distinct from x.prev::date
       returning u.id, x.prev`,
      [JSON.stringify(chunk.map((x) => ({ id: x.userId, today: x.today, prev: x.prev })))],
    );
    const ids = new Set(claimed.map((c) => c.id));
    const mine = chunk.filter((x) => ids.has(x.userId));
    if (mine.length === 0) continue;
    try {
      await send(mine.map((o) => o.email));
    } catch (err) {
      await db.query(
        `update app_user u set last_notified_on = x.prev::date
         from jsonb_to_recordset($1::text::jsonb) as x(id uuid, prev text) where u.id = x.id`,
        [JSON.stringify(mine.map((x) => ({ id: x.userId, prev: x.prev })))],
      );
      throw err;
    }
    result.sent += mine.length;
  }
  return result;
}
