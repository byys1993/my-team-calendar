"use client";

import { useEffect, useMemo, useState } from "react";
import type { Catalog, ScheduleMatch } from "@/lib/schedule";
import { SOURCE_CREDITS, SOURCE_LABEL } from "@/lib/sources";
import { MatchRow } from "./MatchRow";
import { MonthCalendar } from "./MonthCalendar";
import { TeamPicker } from "./TeamPicker";
import { viewOf, type MatchView } from "./matchView";
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
    fetch(`/api/matches?teams=${encodeURIComponent(slugKey)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { matches: ScheduleMatch[] }) => setMatches(d.matches))
      .catch((e) => {
        if (e.name !== "AbortError") setError("일정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [slugKey]);

  const teamName = (slug: string) => teamsBySlug.get(slug)?.nameKo ?? slug;
  const teamShort = (slug: string) => teamsBySlug.get(slug)?.shortKo ?? slug;
  const competitionName = (slug: string) => compsBySlug.get(slug)?.nameKo ?? slug;

  const views = useMemo(
    () => matches.map((m) => viewOf(m, selections)).filter((v): v is MatchView => v !== null),
    [matches, selections],
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
      const v = next && viewOf(next, [s], false);
      if (v) result.set(s.slug, v);
    }
    return result;
  }, [matches, selections, nowMs]);

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
          <h1>마이팀 캘린더</h1>
          {now && <span className="tz">시간대: {browserTimeZone()}</span>}
        </div>
        <button type="button" className="primary" onClick={() => setPickerOpen(true)}>
          팀 선택
        </button>
      </header>

      <section className="team-bar" aria-label="내 팀 (눌러서 켜기/끄기)">
        {selections.length === 0 && loaded && <p className="muted">응원하는 팀을 골라 주세요. 최대 10팀까지 선택할 수 있어요.</p>}
        {selections.map((s) => (
          <button
            key={s.slug}
            type="button"
            className={s.enabled ? "team-chip" : "team-chip off"}
            style={{ "--team": PALETTE[s.color] } as React.CSSProperties}
            aria-pressed={s.enabled}
            title={s.enabled ? "눌러서 숨기기" : "눌러서 보이기"}
            onClick={() => toggle(s.slug)}
          >
            <span className="dot" />
            {teamName(s.slug)}
          </button>
        ))}
      </section>

      {error && <p className="error">{error}</p>}

      {selections.length > 0 && (
        <section className="next-cards" aria-label="팀별 다음 경기">
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
                    <div className="dday">{days !== null ? dDayLabel(days) : ""}</div>
                    <div className="next-vs">
                      vs {v.opponent} <span className={`side side-${v.side}`}>{v.side}</span>
                    </div>
                    <div className="next-when">
                      {dateLabel(matchDateKey(v.match))} {matchTimeLabel(v.match)}
                    </div>
                    <div className="next-comp">{competitionName(v.match.competition)}</div>
                  </>
                ) : (
                  <div className="muted">{loading ? "불러오는 중…" : "예정된 경기 없음"}</div>
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
              <h2>{dateLabel(selectedKey)}</h2>
              {dayItems.length === 0 ? (
                <p className="muted">이 날은 경기가 없습니다.</p>
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

        <section className="card upcoming" aria-label="다가오는 경기">
          <h2>다가오는 경기</h2>
          {loading && matches.length === 0 && <p className="muted">불러오는 중…</p>}
          {!loading && upcoming.length === 0 && <p className="muted">표시할 경기가 없습니다.</p>}
          <ul className="matches">
            {upcoming.slice(0, UPCOMING_LIMIT).map((v) => (
              <MatchRow key={v.match.id} view={v} teamName={teamName} competitionName={competitionName} />
            ))}
          </ul>
          <p className="legend">
            <span className="legend-item">
              <span className="legend-box" /> 확정
            </span>
            <span className="legend-item">
              <span className="legend-box tentative" /> 미확정 (시간 미정·진출 시·대진 추첨 대기·연기)
            </span>
          </p>
        </section>
      </div>

      <footer className="foot">
        {relevantComps.length > 0 && (
          <div className="updates">
            <h2>마지막 업데이트</h2>
            <ul>
              {relevantComps.map((c) => (
                <li key={c.slug}>
                  {c.nameKo} · {c.lastSuccessAt && now ? updatedLabel(c.lastSuccessAt) : "아직 없음"}
                  {c.lastSource && <span className="muted"> ({SOURCE_LABEL(c.lastSource)})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="credits">
          <h2>데이터 출처</h2>
          <ul>
            {/* 대체 소스 데이터(장소 등)도 DB에 남아 있으므로 수집에 쓰는 모든 소스를 항상 표기한다 */}
            {Object.entries(SOURCE_CREDITS).map(([s, c]) => (
              <li key={s}>
                <a href={c.url} target="_blank" rel="noreferrer">
                  {c.text}
                </a>
              </li>
            ))}
          </ul>
          <p className="muted">
            비상업 개인 프로젝트입니다. 일정은 각 리그 사정으로 바뀔 수 있으니 공식 발표를 함께 확인해 주세요.
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
