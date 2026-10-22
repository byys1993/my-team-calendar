import type { Locale } from "@/i18n/config";
import { MESSAGES } from "@/i18n";
import { formatLabel, formatTitle } from "@/i18n/format";
import type { Catalog, ScheduleMatch } from "@/lib/schedule";

// 캘린더 구독(ICS, RFC 5545). 경기 ID를 UID 로 써서 일정이 바뀌어도 캘린더 앱에서 같은 일정으로 갱신되고,
// sequence 가 올라가면 바뀐 것으로 인식한다. 시각은 모두 UTC, 시간 미정 경기는 종일 일정으로 넣는다.

export const ICS_DOMAIN = "my-team-calendar.com";

const SPORT_ICON: Record<string, string> = {
  soccer: "⚽",
  baseball: "⚾",
  basketball: "🏀",
  "american-football": "🏈",
  hockey: "🏒",
  motorsport: "🏎️",
  esports: "🎮",
};

// 경기 길이 (분). 캘린더에 칸을 잡기 위한 대략값.
const DURATION_MIN: Record<string, number> = {
  soccer: 120,
  baseball: 210,
  basketball: 135,
  "american-football": 210,
  hockey: 150,
  motorsport: 120,
  esports: 180,
};

// 'team-a,team-b' → 검증된 slug 목록 (최대 10개)
export function parseTeamList(raw: string): string[] | null {
  const slugs = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  if (slugs.length === 0 || slugs.length > 10) return null;
  return slugs.every((s) => /^[a-z0-9-]{1,64}$/.test(s)) ? slugs : null;
}

const escapeText = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// 한 줄 75바이트 제한: 넘으면 다음 줄을 공백으로 시작해 잇는다 (한글이 중간에 잘리지 않게 글자 단위로)
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // 이어지는 줄은 앞의 공백 1바이트
    if (bytes + b > limit) {
      parts.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

const utcStamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateStamp = (ymd: string) => ymd.replace(/-/g, "");
const nextDay = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export function buildIcs(opts: {
  matches: ScheduleMatch[];
  catalog: Catalog;
  locale: Locale;
  siteUrl: string;
  now?: Date;
}): string {
  const { matches, catalog, locale, siteUrl } = opts;
  const m = MESSAGES[locale];
  const now = (opts.now ?? new Date()).toISOString();
  const compName = new Map(catalog.competitions.map((c) => [c.slug, c.name]));
  const label = (s: string) => formatLabel(s, m) ?? s;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${ICS_DOMAIN}//My Team Calendar//${locale.toUpperCase()}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(m.app.title)}`,
    "X-WR-TIMEZONE:UTC",
    // 캘린더 앱이 얼마나 자주 새로 받을지 (지원하는 앱만)
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];

  for (const x of matches) {
    const icon = SPORT_ICON[x.sport] ? `${SPORT_ICON[x.sport]} ` : "";
    const who = x.title && !x.away ? formatTitle(x.title, m, locale)! : `${label(x.homeLabel)} ${m.match.vs} ${label(x.awayLabel)}`;
    const tentative = x.status === "conditional" || x.status === "draw_pending" || x.status === "postponed";
    const note = tentative || x.status === "cancelled" ? ` (${m.status[x.status as keyof typeof m.status]})` : "";
    const details = [compName.get(x.competition), formatLabel(x.roundLabel, m)].filter(Boolean).join(" · ");

    lines.push("BEGIN:VEVENT", `UID:${x.id}@${ICS_DOMAIN}`, `DTSTAMP:${utcStamp(x.updatedAt ?? now)}`);
    if (x.startAt && x.status !== "time_tbd") {
      const end = new Date(new Date(x.startAt).getTime() + (DURATION_MIN[x.sport] ?? 120) * 60_000).toISOString();
      lines.push(`DTSTART:${utcStamp(new Date(x.startAt).toISOString())}`, `DTEND:${utcStamp(end)}`);
    } else {
      // 시간 미정: 날짜만 있는 종일 일정 (잠정 시각이 있으면 그 날짜, UTC 기준)
      const day = x.dateOnly ?? new Date(x.startAt!).toISOString().slice(0, 10);
      lines.push(`DTSTART;VALUE=DATE:${dateStamp(day)}`, `DTEND;VALUE=DATE:${dateStamp(nextDay(day))}`);
    }
    lines.push(
      `SUMMARY:${escapeText(`${icon}${who}${note}`)}`,
      `DESCRIPTION:${escapeText([details, x.status === "time_tbd" ? m.match.timeTbd : "", siteUrl].filter(Boolean).join("\n"))}`,
    );
    if (x.venue) lines.push(`LOCATION:${escapeText(x.venue)}`);
    lines.push(
      `STATUS:${x.status === "cancelled" ? "CANCELLED" : tentative ? "TENTATIVE" : "CONFIRMED"}`,
      `SEQUENCE:${x.sequence ?? 0}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
