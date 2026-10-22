"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n/client";
import { formatLabel, formatTitle } from "@/i18n/format";
import { MAX_TEAMS, type Catalog, type ScheduleMatch } from "@/lib/schedule";
import { SOURCE_CREDITS, SOURCE_LABEL } from "@/lib/sources";
import { LanguageSelect } from "./LanguageSelect";
import { MatchRow } from "./MatchRow";
import { MonthCalendar } from "./MonthCalendar";
import { TeamPicker } from "./TeamPicker";
import { viewOf, type Display, type MatchView } from "./matchView";
import { PALETTE, useSelection } from "./selection";
import {
  browserTimeZone,
  dateLabel,
  daysBetween,
  dDayLabel,
  matchDateKey,
  matchSortTime,
  matchTimeLabel,
  toDateKey,
  updatedLabel,
} from "./time";

const UPCOMING_LIMIT = 15;

export function CalendarApp({ catalog }: { catalog: Catalog }) {
  const { m: t, t: fmt, intl, locale } = useI18n();
  const display: Display = useMemo(
    () => ({ label: (raw) => formatLabel(raw, t) ?? raw, title: (raw) => formatTitle(raw, t, locale) ?? raw }),
    [t, locale],
  );
  const teamsBySlug = useMemo(() => new Map(catalog.teams.map((t) => [t.slug, t])), [catalog.teams]);
  const compsBySlug = useMemo(() => new Map(catalog.competitions.map((c) => [c.slug, c])), [catalog.competitions]);
  const { list: selections, loaded, add, remove, toggle } = useSelection(catalog.teams.map((t) => t.slug));

  const [pickerOpen, setPickerOpen] = useState(false);
  const [matches, setMatches] = useState<ScheduleMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 시간대·오늘 날짜는 브라우저에서만 정한다 (서버 렌더링 결과와 어긋나지 않도록)
  const [now, setNow] = useState<Date | null>(null);
  const [cursor, setCursor] = useState<{ y: number; m: number } | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>("");

  useEffect(() => {
    const d = new Date();
    setNow(d);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
    setSelectedKey(toDateKey(d));
  }, []);

  useEffect(() => {
    if (loaded && selections.length === 0) setPickerOpen(true);
  }, [loaded, selections.length]);

  const slugKey = selections.map((s) => s.slug).sort().join(",");
  useEffect(() => {
    if (!slugKey) {
      setMatches([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/matches?teams=${encodeURIComponent(slugKey)}&lang=${locale}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { matches: ScheduleMatch[] }) => setMatches(d.matches))
      .catch((e) => {
        if (e.name !== "AbortError") setError(t.app.loadError);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [slugKey, locale, t]);

  const teamName = (slug: string) => teamsBySlug.get(slug)?.name ?? slug;
  const teamShort = (slug: string) => teamsBySlug.get(slug)?.short ?? slug;
  const competitionName = (slug: string) => compsBySlug.get(slug)?.name ?? slug;

  const views = useMemo(
    () => matches.map((m) => viewOf(m, selections, display)).filter((v): v is MatchView => v !== null),
    [matches, selections, display],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, MatchView[]>();
    for (const v of views) {
      const key = matchDateKey(v.match);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(v);
    }
    return map;
  }, [views]);

  const nowMs = now?.getTime() ?? 0;
  // 킥오프 후 2시간까지는 '진행 중'으로 보고 목록에 남긴다
  const upcoming = useMemo(
    () => views.filter((v) => matchSortTime(v.match) >= nowMs - 2 * 3600_000 && v.match.status !== "cancelled"),
    [views, nowMs],
  );

  const nextByTeam = useMemo(() => {
    const result = new Map<string, MatchView>();
    for (const s of selections) {
      const next = matches
        .filter((m) => (m.home === s.slug || m.away === s.slug) && m.status !== "cancelled")
        .find((m) => matchSortTime(m) >= nowMs - 2 * 3600_000);
      const v = next && viewOf(next, [s], display, false);
      if (v) result.set(s.slug, v);
    }
    return result;
  }, [matches, selections, nowMs, display]);

  const relevantComps = useMemo(() => {
    const slugs = new Set<string>();
    for (const s of selections) {
      const c = teamsBySlug.get(s.slug)?.competition;
      if (c) slugs.add(c);
    }
    for (const m of matches) slugs.add(m.competition);
    return catalog.competitions.filter((c) => slugs.has(c.slug));
  }, [selections, matches, teamsBySlug, catalog.competitions]);

  const todayKey = now ? toDateKey(now) : "";
  const dayItems = byDay.get(selectedKey) ?? [];

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>{t.app.title}</h1>
          {now && <span className="tz">{fmt(t.app.timeZone, { tz: browserTimeZone() })}</span>}
        </div>
        <div className="top-actions">
          <LanguageSelect />
          <button type="button" className="primary" onClick={() => setPickerOpen(true)}>
            {t.app.pickTeams}
          </button>
        </div>
      </header>

      <section className="team-bar" aria-label={t.app.pickTeams}>
        {selections.length === 0 && loaded && <p className="muted">{fmt(t.app.emptyHint, { max: MAX_TEAMS })}</p>}
        {selections.map((s) => (
          <button
            key={s.slug}
            type="button"
            className={s.enabled ? "team-chip" : "team-chip off"}
            style={{ "--team": PALETTE[s.color] } as React.CSSProperties}
            aria-pressed={s.enabled}
            title={s.enabled ? t.app.toggleHide : t.app.toggleShow}
            onClick={() => toggle(s.slug)}
          >
            <span className="dot" />
            {teamName(s.slug)}
          </button>
        ))}
      </section>

      {error && <p className="error">{error}</p>}

      {selections.length > 0 && (
        <section className="next-cards" aria-label={t.app.upcoming}>
          {selections.map((s) => {
            const v = nextByTeam.get(s.slug);
            const days = v && todayKey ? daysBetween(todayKey, matchDateKey(v.match)) : null;
            return (
              <article
                key={s.slug}
                className={`next-card${s.enabled ? "" : " off"}${v && v.match.status !== "scheduled" ? " tentative" : ""}`}
                style={{ "--team": PALETTE[s.color] } as React.CSSProperties}
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
                      {dateLabel(matchDateKey(v.match), intl)} {matchTimeLabel(v.match, intl, t.match.timeTbd)}
                    </div>
                    <div className="next-comp">{competitionName(v.match.competition)}</div>
                  </>
                ) : (
                  <div className="muted">{loading ? t.app.loading : t.app.noNext}</div>
                )}
              </article>
            );
          })}
        </section>
      )}

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
                setCursor({ y: now!.getFullYear(), m: now!.getMonth() });
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
            </section>
          )}
        </div>

        <section className="card upcoming" aria-label={t.app.upcoming}>
          <h2>{t.app.upcoming}</h2>
          {loading && matches.length === 0 && <p className="muted">{t.app.loading}</p>}
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

      <footer className="foot">
        {relevantComps.length > 0 && (
          <div className="updates">
            <h2>{t.app.lastUpdated}</h2>
            <ul>
              {relevantComps.map((c) => (
                <li key={c.slug}>
                  {c.name} · {c.lastSuccessAt && now ? updatedLabel(c.lastSuccessAt, intl) : t.app.never}
                  {c.lastSource && <span className="muted"> ({SOURCE_LABEL(c.lastSource)})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
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
          <p className="muted">{t.app.disclaimer}</p>
          <p>
            <a href="/privacy">{t.app.privacy}</a>
          </p>
        </div>
      </footer>

      {pickerOpen && (
        <TeamPicker
          catalog={catalog}
          selections={selections}
          onAdd={add}
          onRemove={remove}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
