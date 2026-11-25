"use client";

import { useRouter } from "next/navigation";
import { track } from "./track";
import { useEffect, useMemo, useRef, useState } from "react";
import { LOCALE_COOKIE, isLocale } from "@/i18n/config";
import { useI18n } from "@/i18n/client";
import { formatLabel, formatTitle } from "@/i18n/format";
import { MAX_TEAMS, NO_DAY_LIST_SPORTS, type Catalog, type ScheduleMatch } from "@/lib/schedule";
import { SOURCE_CREDITS, SOURCE_LABEL } from "@/lib/sources";
import { AccountMenu } from "./AccountMenu";
import { ColorPicker } from "./ColorPicker";
import { LanguageSelect } from "./LanguageSelect";
import { useAccount } from "./useAccount";
import { LeagueCalendar } from "./LeagueCalendar";
import { LeagueDay } from "./LeagueDay";
import { MatchRow } from "./MatchRow";
import { MonthCalendar } from "./MonthCalendar";
import { TeamPicker } from "./TeamPicker";
import { involves, viewOf, type Display, type MatchView } from "./matchView";
import { teamVars } from "@/lib/palette";
import { useSelection, type Selection } from "./selection";
import { demoCandidates, pickDemo } from "./demo";
import { TimeZoneSelect } from "./TimeZoneSelect";
import { VisitorBeacon } from "./VisitorStats";
import { CalendarSubscribe, SubscribeNotice, useSubscription } from "./CalendarSubscribe";
import { OffSeason } from "./OffSeason";
import { ShareButton } from "./ShareButton";
import { SpoilerProvider, SpoilerToggle } from "./spoiler";
import { useF1MainOnly } from "./f1main";
import { RecordsView } from "./RecordsView";
import { ContactButton } from "./ContactForm";
import { AUTO, browserTimeZone, isValidTimeZone, TimeZoneProvider, useTimeZonePref } from "./timezone";
import {
  dateLabel,
  daysBetween,
  dDayLabel,
  matchDateKey,
  matchSortTime,
  isDawn,
  keyParts,
  matchTimeLabel,
  toDateKey,
  updatedLabel,
} from "./time";

const UPCOMING_LIMIT = 15;

// '5분 전', '2시간 전' (그 언어 방식)
function ago(when: Date, now: Date, intl: string): string {
  const rtf = new Intl.RelativeTimeFormat(intl, { numeric: "auto" });
  const min = Math.max(0, Math.round((now.getTime() - when.getTime()) / 60_000));
  if (min < 60) return rtf.format(-min, "minute");
  const h = Math.round(min / 60);
  if (h < 48) return rtf.format(-h, "hour");
  return rtf.format(-Math.round(h / 24), "day");
}

// loginEnabled: 메일 발송이 설정되지 않은 운영 환경에서는 로그인 버튼을 숨긴다 (로그인 없이도 모든 기능 사용 가능)
export function CalendarApp({
  catalog,
  loginEnabled,
  contactEnabled,
  turnstileSiteKey,
}: {
  catalog: Catalog;
  loginEnabled: boolean;
  contactEnabled: boolean;
  turnstileSiteKey: string | null;
}) {
  const { m: t, t: fmt, intl, locale } = useI18n();
  const display: Display = useMemo(
    () => ({ label: (raw) => formatLabel(raw, t) ?? raw, title: (raw) => formatTitle(raw, t, locale) ?? raw }),
    [t, locale],
  );
  const teamsBySlug = useMemo(() => new Map(catalog.teams.map((t) => [t.slug, t])), [catalog.teams]);
  const compsBySlug = useMemo(() => new Map(catalog.competitions.map((c) => [c.slug, c])), [catalog.competitions]);
  const { list: selections, loaded, add, remove, toggle, replace, clear, setColor } = useSelection(catalog.teams.map((t) => t.slug));
  const auth = useAccount();
  const { account, checked, save } = auth;
  const router = useRouter();
  const f1Main = useF1MainOnly();
  const subscription = useSubscription(selections.filter((s) => s.enabled).map((s) => s.slug), f1Main.on);
  const setF1Main = (v: boolean) => {
    f1Main.set(v);
    if (account) void save({ f1MainOnly: v });
  };

  // 로그인하면 계정에 저장된 팀을 불러오고(계정에 없으면 지금 고른 팀을 올리고), 이후 바뀔 때마다 저장한다.
  // synced: 마지막으로 계정과 맞춘 목록. null 이면 아직 맞추지 않음.
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (!account) {
      synced.current = null;
      return;
    }
    if (!loaded || synced.current !== null) return;
    if (account.selections.length > 0) {
      synced.current = JSON.stringify(account.selections);
      replace(account.selections);
    } else {
      synced.current = JSON.stringify(selections);
      void save({ selections, locale });
    }
    // F1 주요 세션만: 계정이나 이 브라우저 중 한쪽이라도 켜 두었으면 켠다 (알림 메일도 같은 설정을 쓴다)
    if (account.f1MainOnly) f1Main.set(true);
    else if (f1Main.on) void save({ f1MainOnly: true });
    // 다른 기기에서 고른 시간대가 있으면 그대로 쓴다
    if (account.timeZone && isValidTimeZone(account.timeZone)) setTzPref(account.timeZone);
    else if (tzPref !== AUTO) void save({ timeZone: tzPref });
    // 다른 기기에서 고른 언어가 있으면 그 언어로 바꾼다
    if (account.locale && account.locale !== locale && isLocale(account.locale)) {
      document.cookie = `${LOCALE_COOKIE}=${account.locale}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
    } else if (!account.locale) {
      // 알림 메일을 이 언어로 보내도록 지금 언어를 남긴다
      void save({ locale });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 로그인 시점에 한 번만 맞춘다
  }, [account, loaded]);

  useEffect(() => {
    if (!account || synced.current === null) return;
    const json = JSON.stringify(selections);
    if (json === synced.current) return;
    const timer = setTimeout(() => {
      synced.current = json;
      void save({ selections });
    }, 600);
    return () => clearTimeout(timer);
  }, [selections, account, save]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [colorFor, setColorFor] = useState<string | null>(null);
  const [matches, setMatches] = useState<ScheduleMatch[]>([]);
  // 앞으로 남은 경기가 있는 대회 (예정 경기가 없는 팀이라도 그 대회가 진행 중이면 '시즌 종료'라 하지 않는다)
  const [ongoing, setOngoing] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 시간대·오늘 날짜는 브라우저에서만 정한다 (서버 렌더링 결과와 어긋나지 않도록)
  const [now, setNow] = useState<Date | null>(null);
  const [cursor, setCursor] = useState<{ y: number; m: number } | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>("");
  // 화면: 응원팀 일정(캘린더) / 리그 일정 / 리그 순위
  const [view, setView] = useState<"calendar" | "league" | "records">("calendar");
  // 리그 일정 탭을 특정 리그·날짜로 열 때 (같은 리그 다른 경기 → 리그 전체 일정)
  const [leagueTarget, setLeagueTarget] = useState<{ comp: string; date: string } | null>(null);
  // 화면 시간대: '자동'이면 브라우저 시간대 (브라우저 값은 화면이 뜬 뒤에만 알 수 있다)
  const { pref: tzPref, setPref: setTzPref } = useTimeZonePref();
  const tz = now ? (tzPref === AUTO ? browserTimeZone() : tzPref) : "UTC";

  // 알림 메일 시각 계산용으로 지금 쓰는 시간대를 계정에 남긴다 ('자동'이면 브라우저 시간대)
  const lastTzSent = useRef<string | null>(null);
  useEffect(() => {
    if (!account || !now || account.lastTz === tz || lastTzSent.current === tz) return;
    lastTzSent.current = tz;
    void save({ lastTz: tz });
  }, [account, now, tz, save]);

  useEffect(() => {
    const d = new Date();
    const today = keyParts(toDateKey(d, browserTimeZone()));
    setNow(d);
    setCursor({ y: today.y, m: today.m });
    setSelectedKey(toDateKey(d, browserTimeZone()));
  }, []);

  // 팀 페이지의 '이 팀을 추가' 버튼(/?add=팀)이나 공유 링크(/?add=팀,팀)로 오면 그 팀들을 내 팀에 넣고 주소에서 지운다
  const addFromLink = useRef(typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("add") : null);
  useEffect(() => {
    const list = addFromLink.current;
    if (!loaded || !list) return;
    const slugs = list.split(",").filter((s) => teamsBySlug.has(s));
    for (const slug of slugs) add(slug);
    if (slugs.length) {
      track("link_add");
      track("team_pick");
    }
    addFromLink.current = null;
    window.history.replaceState(null, "", window.location.pathname);
  }, [loaded, teamsBySlug, add]);

  // 처음 온 사람(고른 팀 없음): 팀 선택 창부터 띄우지 않고, 시즌 중인 예시 팀들의 실제 일정으로 캘린더를 채워 보여 준다.
  // 예시 팀을 못 고르면(조회 실패 등) 예전처럼 팀 선택 창을 연다. 팀을 하나라도 고르면 예시는 끝난다.
  const [demo, setDemo] = useState<{ teams: Selection[]; matches: ScheduleMatch[]; ongoing: Set<string> } | null>(null);
  const demoTried = useRef(false);
  useEffect(() => {
    // 로그인 확인이 끝난 뒤에도 고른 팀이 없을 때만 (링크로 팀을 추가하는 중이면 하지 않는다)
    if (addFromLink.current || demoTried.current) return;
    if (!(loaded && checked && selections.length === 0 && !account?.selections.length)) return;
    demoTried.current = true;
    const candidates = demoCandidates(locale, (s) => teamsBySlug.has(s));
    fetch(`/api/matches?teams=${encodeURIComponent(candidates.join(","))}&lang=${locale}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { matches: ScheduleMatch[]; ongoing?: string[] }) => {
        const picked = pickDemo(d.matches, candidates, (s) => teamsBySlug.get(s)?.sport, Date.now());
        if (picked.length < 2) return setPickerOpen(true);
        setDemo({
          teams: picked.map((slug, i) => ({ slug, color: i, enabled: true })),
          matches: d.matches.filter((m) => picked.some((slug) => involves(m, slug))),
          ongoing: new Set(d.ongoing ?? []),
        });
        track("demo_view");
      })
      .catch(() => setPickerOpen(true));
  }, [loaded, checked, selections.length, account, locale, teamsBySlug]);
  const demoOn = demo !== null && selections.length === 0;
  // 화면에 보일 팀·경기 (예시 중이면 예시 팀). 구독·공유·계정 저장·다른 탭은 늘 실제로 고른 팀만 쓴다
  const shownSel = demoOn ? demo.teams : selections;
  const shownMatches = demoOn ? demo.matches : matches;
  const shownOngoing = demoOn ? demo.ongoing : ongoing;
  const openPicker = () => {
    if (demoOn) track("demo_pick");
    setPickerOpen(true);
  };

  const slugKey = selections.map((s) => s.slug).sort().join(",");
  useEffect(() => {
    if (!slugKey) {
      setMatches([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/matches?teams=${encodeURIComponent(slugKey)}&lang=${locale}${f1Main.on ? "&f1=main" : ""}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { matches: ScheduleMatch[]; ongoing?: string[] }) => {
        setMatches(d.matches);
        setOngoing(new Set(d.ongoing ?? []));
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(t.app.loadError);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [slugKey, locale, t, f1Main.on]);

  const teamName = (slug: string) => teamsBySlug.get(slug)?.name ?? slug;
  const teamShort = (slug: string) => teamsBySlug.get(slug)?.short ?? slug;
  const competitionName = (slug: string) => compsBySlug.get(slug)?.name ?? slug;

  const views = useMemo(
    () => shownMatches.map((m) => viewOf(m, shownSel, display)).filter((v): v is MatchView => v !== null),
    [shownMatches, shownSel, display],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, MatchView[]>();
    for (const v of views) {
      const key = matchDateKey(v.match, tz);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(v);
    }
    return map;
  }, [views, tz]);

  const nowMs = now?.getTime() ?? 0;
  // 킥오프 후 2시간까지는 '진행 중'으로 보고 목록에 남긴다
  const upcoming = useMemo(
    () => views.filter((v) => matchSortTime(v.match) >= nowMs - 2 * 3600_000 && v.match.status !== "cancelled"),
    [views, nowMs],
  );

  const nextByTeam = useMemo(() => {
    const result = new Map<string, MatchView>();
    for (const s of shownSel) {
      const next = shownMatches
        .filter((m) => involves(m, s.slug) && m.status !== "cancelled")
        .find((m) => matchSortTime(m) >= nowMs - 2 * 3600_000);
      const v = next && viewOf(next, [s], display, false);
      if (v) result.set(s.slug, v);
    }
    return result;
  }, [shownMatches, shownSel, nowMs, display]);

  // 예정 경기가 없는 팀(비시즌·탈락)의 마지막으로 끝난 경기
  const lastByTeam = useMemo(() => {
    const result = new Map<string, ScheduleMatch>();
    for (const m of shownMatches) {
      if (m.homeScore == null) continue;
      for (const slug of [m.home, m.away]) if (slug) result.set(slug, m); // 시간순이라 마지막 것이 남는다
    }
    return result;
  }, [shownMatches]);

  // 다음 경기 카드: 켜 둔 팀의 임박한 경기부터, 꺼 둔 팀은 그 뒤, 예정 경기가 없는 팀은 맨 뒤 (같으면 고른 순서)
  const cardOrder = useMemo(() => {
    const rank = (s: Selection) => {
      const v = nextByTeam.get(s.slug);
      return [v ? 0 : 1, s.enabled ? 0 : 1, v ? matchSortTime(v.match) : 0];
    };
    return [...shownSel].sort((x, y) => {
      const [a, b] = [rank(x), rank(y)];
      return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    });
  }, [shownSel, nextByTeam]);

  const relevantComps = useMemo(() => {
    const slugs = new Set<string>();
    for (const s of shownSel) {
      const c = teamsBySlug.get(s.slug)?.competition;
      if (c) slugs.add(c);
    }
    for (const m of shownMatches) slugs.add(m.competition);
    return catalog.competitions.filter((c) => slugs.has(c.slug));
  }, [shownSel, shownMatches, teamsBySlug, catalog.competitions]);

  const todayKey = now ? toDateKey(now, tz) : "";
  // 모든 대회 중 가장 최근에 일정을 받은 시각
  const lastUpdate = useMemo(() => {
    const times = catalog.competitions.map((c) => (c.lastSuccessAt ? new Date(c.lastSuccessAt).getTime() : 0));
    // 수집이 돌았지만 바뀐 일정이 없던 경우도 '확인한 시각'으로 본다
    if (catalog.lastSyncAt) times.push(new Date(catalog.lastSyncAt).getTime());
    const max = Math.max(0, ...times);
    return max ? new Date(max) : null;
  }, [catalog.competitions, catalog.lastSyncAt]);
  const dayItems = useMemo(() => byDay.get(selectedKey) ?? [], [byDay, selectedKey]);
  // 그날 내 팀이 뛴 대회 (같은 리그 다른 경기용, 이벤트형 종목 제외)
  const dayComps = useMemo(
    () => [...new Set(dayItems.filter((v) => !NO_DAY_LIST_SPORTS.includes(v.match.sport)).map((v) => v.match.competition))],
    [dayItems],
  );
  const dayIds = useMemo(() => new Set(dayItems.map((v) => v.match.id)), [dayItems]);

  return (
    <TimeZoneProvider tz={tz}>
    <SpoilerProvider>
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>{t.app.title}</h1>
          {now && (
            <TimeZoneSelect
              value={tzPref}
              onChange={(v) => {
                setTzPref(v);
                if (account) void save({ timeZone: v === AUTO ? null : v });
              }}
            />
          )}
          <VisitorBeacon />
          {/* 서비스 규모와 최신성: 사용자 수 대신 다루는 범위와 갱신 시각으로 믿음을 준다 */}
          <p className="scale-line">
            <span>{fmt(t.app.scale, { c: catalog.competitions.length, t: catalog.teams.length.toLocaleString(intl) })}</span>
            {lastUpdate && now && (
              <span className="fresh">
                <span className="live-dot" aria-hidden="true" />
                {fmt(t.app.updatedAgo, { ago: ago(lastUpdate, now, intl) })}
              </span>
            )}
          </p>
        </div>
        <div className="top-actions">
          <LanguageSelect onChange={(l) => account && void save({ locale: l })} />
          {(loginEnabled || account) && (
            <AccountMenu
              account={account}
              requestCode={auth.requestCode}
              verify={auth.verify}
              logout={auth.logout}
              deleteAccount={auth.deleteAccount}
              saveNotify={auth.saveNotify}
              timeZone={tz}
              turnstileSiteKey={turnstileSiteKey}
            />
          )}
          <button type="button" className="primary" onClick={openPicker}>
            {t.app.pickTeams}
          </button>
        </div>
      </header>

      {demoOn && (
        <div className="notice-box demo-notice" role="status">
          <div>
            <strong>👀 {t.app.demoTitle}</strong>
            <p>{fmt(t.app.demoBody, { teams: demo.teams.map((s) => teamShort(s.slug)).join(" · ") })}</p>
          </div>
          <button type="button" className="primary" onClick={openPicker}>
            {t.app.demoPick}
          </button>
        </div>
      )}

      <section className="team-bar" aria-label={t.app.pickTeams}>
        {selections.length === 0 && loaded && !demoOn && <p className="muted">{fmt(t.app.emptyHint, { max: MAX_TEAMS })}</p>}
        {/* 예시 팀: 눌러도 바뀌지 않는 이름표 */}
        {demoOn &&
          demo.teams.map((s) => (
            <span key={s.slug} className="team-chip demo-chip" style={teamVars(s.color) as React.CSSProperties}>
              <span className="dot" />
              {teamName(s.slug)}
            </span>
          ))}
        {selections.map((s) => (
          // 색 점을 누르면 색 고르기, 이름을 누르면 켜기/끄기
          <span
            key={s.slug}
            className={s.enabled ? "team-chip" : "team-chip off"}
            style={teamVars(s.color) as React.CSSProperties}
          >
            <button
              type="button"
              className="chip-color"
              title={t.app.changeColor}
              aria-label={fmt(t.app.colorTitle, { team: teamName(s.slug) })}
              onClick={() => setColorFor(s.slug)}
            >
              <span className="dot" />
            </button>
            <button
              type="button"
              className="chip-name"
              aria-pressed={s.enabled}
              title={s.enabled ? t.app.toggleHide : t.app.toggleShow}
              onClick={() => toggle(s.slug)}
            >
              {teamName(s.slug)}
            </button>
          </span>
        ))}
        <CalendarSubscribe sub={subscription} />
        <ShareButton slugs={selections.map((s) => s.slug)} names={selections.map((s) => teamShort(s.slug))} />
        {selections.length > 0 && <SpoilerToggle />}
      </section>

      {/* 아직 캘린더에 추가하지 않았거나, 추가한 뒤 팀·설정이 바뀌었을 때 */}
      {!pickerOpen && <SubscribeNotice sub={subscription} />}

      {error && <p className="error">{error}</p>}

      <nav className="view-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={view === "calendar"} onClick={() => setView("calendar")}>
          📅 {t.records.calendarTab}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "league"}
          onClick={() => {
            setView("league");
            track("league_tab");
          }}
        >
          🗓️ {t.app.leagueTab}
        </button>
        <button type="button" role="tab" aria-selected={view === "records"} onClick={() => setView("records")}>
          📊 {t.records.tab}
        </button>
      </nav>

      {view === "league" && todayKey && (
        <LeagueCalendar catalog={catalog} selections={selections} todayKey={todayKey} target={leagueTarget} />
      )}

      {view === "records" && <RecordsView catalog={catalog} selections={selections} />}

      {view === "calendar" && shownSel.length > 0 && (
        <section className="next-cards" aria-label={t.app.upcoming}>
          {cardOrder.map((s) => {
            const v = nextByTeam.get(s.slug);
            const days = v && todayKey ? daysBetween(todayKey, matchDateKey(v.match, tz)) : null;
            return (
              <article
                key={s.slug}
                className={`next-card${s.enabled ? "" : " off"}${v && v.match.status !== "scheduled" ? " tentative" : ""}`}
                style={teamVars(s.color) as React.CSSProperties}
              >
                <div className="next-team">{teamName(s.slug)}</div>
                {v ? (
                  <>
                    <div className="dday">{days !== null ? dDayLabel(days, t.match.dday) : ""}</div>
                    <div className="next-vs">
                      {v.side ? `${t.match.vs} ${v.opponent} ` : v.opponent}
                      {v.side && v.side !== "vs" && <span className={`side side-${v.side}`}>{t.match[v.side]}</span>}
                    </div>
                    <div className="next-when">
                      {dateLabel(matchDateKey(v.match, tz), intl)}{" "}
                      {isDawn(v.match, tz) && (
                        <span className="dawn" title={t.match.dawn} aria-label={t.match.dawn}>
                          🌙
                        </span>
                      )}
                      {matchTimeLabel(v.match, intl, t.match.timeTbd, tz)}
                    </div>
                    <div className="next-comp">{competitionName(v.match.competition)}</div>
                    {v.match.broadcast && (
                      <div className="broadcast" title={t.match.broadcast}>
                        📺 {v.match.broadcast}
                      </div>
                    )}
                  </>
                ) : loading ? (
                  <div className="muted">{t.app.loading}</div>
                ) : (
                  <OffSeason
                    team={s.slug}
                    last={lastByTeam.get(s.slug)}
                    competition={teamsBySlug.get(s.slug)?.competition ?? null}
                    competitionType={compsBySlug.get(teamsBySlug.get(s.slug)?.competition ?? "")?.type ?? null}
                    ongoingName={(c) => (shownOngoing.has(c) ? competitionName(c) : null)}
                  />
                )}
              </article>
            );
          })}
        </section>
      )}

      {view === "calendar" && (
        <div className="main-grid">
          <div>
            {cursor && (
              <MonthCalendar
                year={cursor.y}
                month={cursor.m}
                todayKey={todayKey}
                selectedKey={selectedKey}
                byDay={byDay}
                teamShort={teamShort}
                onSelectDay={setSelectedKey}
                onMove={(delta) =>
                  setCursor((c) => {
                    const d = new Date(c!.y, c!.m + delta, 1);
                    return { y: d.getFullYear(), m: d.getMonth() };
                  })
                }
                onToday={() => {
                  const today = keyParts(todayKey);
                  setCursor({ y: today.y, m: today.m });
                  setSelectedKey(todayKey);
                }}
              />
            )}
            {selectedKey && (
              <section className="card day-list" aria-live="polite">
                <h2>{dateLabel(selectedKey, intl)}</h2>
                {dayItems.length === 0 ? (
                  <p className="muted">{t.app.noMatchesDay}</p>
                ) : (
                  <ul className="matches">
                    {dayItems.map((v) => (
                      <MatchRow key={v.match.id} view={v} teamName={teamName} competitionName={competitionName} showDate={false} />
                    ))}
                  </ul>
                )}
                {dayComps.length > 0 && (
                  <LeagueDay
                    key={`${selectedKey}|${dayComps.join(",")}`}
                    competitions={dayComps}
                    dateKey={selectedKey}
                    excludeIds={dayIds}
                    competitionName={competitionName}
                    onOpenLeague={(comp) => {
                      setLeagueTarget({ comp, date: selectedKey });
                      setView("league");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  />
                )}
              </section>
            )}
          </div>

          <section className="card upcoming" aria-label={t.app.upcoming}>
            <h2>{t.app.upcoming}</h2>
            {loading && shownMatches.length === 0 && <p className="muted">{t.app.loading}</p>}
            {!loading && upcoming.length === 0 && <p className="muted">{t.app.noUpcoming}</p>}
            <ul className="matches">
              {upcoming.slice(0, UPCOMING_LIMIT).map((v) => (
                <MatchRow key={v.match.id} view={v} teamName={teamName} competitionName={competitionName} />
              ))}
            </ul>
            <p className="legend">
              <span className="legend-item">
                <span className="legend-box" /> {t.app.legendConfirmed}
              </span>
              <span className="legend-item">
                <span className="legend-box tentative" /> {t.app.legendTentative}
              </span>
            </p>
          </section>
        </div>
      )}

      <footer className="foot">
        {relevantComps.length > 0 && (
          <div className="updates">
            <h2>{t.app.lastUpdated}</h2>
            <ul>
              {relevantComps.map((c) => (
                <li key={c.slug}>
                  {c.name} · {c.lastSuccessAt && now ? updatedLabel(c.lastSuccessAt, intl, tz) : t.app.never}
                  {c.lastSource && <span className="muted"> ({SOURCE_LABEL(c.lastSource)})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* 리그별 페이지 링크 (검색엔진이 팀·리그 페이지를 찾아가는 길) */}
        <div className="league-links">
          <h2>{t.app.leagues}</h2>
          <ul>
            {catalog.competitions.map((c) => (
              <li key={c.slug}>
                <a href={`/league/${c.slug}`}>{c.name}</a>
              </li>
            ))}
          </ul>
        </div>
        <div className="credits">
          <h2>{t.app.dataSources}</h2>
          <ul>
            {/* 대체 소스 데이터(장소 등)도 DB에 남아 있으므로 수집에 쓰는 모든 소스를 항상 표기한다 */}
            {Object.entries(SOURCE_CREDITS).map(([s, c]) => (
              <li key={s}>
                <a href={c.url} target="_blank" rel="noreferrer">
                  {locale === "ko" ? c.text.ko : c.text.en}
                </a>
              </li>
            ))}
          </ul>
          {contactEnabled && (
            <div className="contact">
              <h2>{t.app.contact}</h2>
              <p>{t.app.contactHint}</p>
              <ContactButton turnstileSiteKey={turnstileSiteKey} />
            </div>
          )}
          <p className="muted">{t.app.disclaimer}</p>
          <p className="foot-links">
            <a href="/about">{t.app.about}</a>
            <a href="/privacy">{t.app.privacy}</a>
          </p>
        </div>
      </footer>

      {colorFor && (
        <ColorPicker
          teamName={teamName(colorFor)}
          current={selections.find((s) => s.slug === colorFor)?.color ?? 0}
          onPick={(c) => setColor(colorFor, c)}
          onClose={() => setColorFor(null)}
        />
      )}

      {pickerOpen && (
        <TeamPicker
          catalog={catalog}
          selections={selections}
          onAdd={(slug) => {
            add(slug);
            setDemo(null);
            track("team_pick");
          }}
          onRemove={remove}
          onClear={clear}
          f1MainOnly={f1Main.on}
          onF1MainOnly={setF1Main}
          onClose={() => {
            // 아무 팀도 고르지 않고 닫음 (첫 화면에서 빠져나가는 사람이 얼마나 되는지 보려고)
            if (selections.length === 0) track("picker_skip");
            setPickerOpen(false);
          }}
        />
      )}
    </div>
    </SpoilerProvider>
    </TimeZoneProvider>
  );
}
