"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { teamVars } from "@/lib/palette";
import type { Catalog, ScheduleMatch } from "@/lib/schedule";
import { LeagueMatchList } from "./LeagueMatchList";
import { MonthCalendar } from "./MonthCalendar";
import type { Selection } from "./selection";
import { dateLabel, keyParts, matchDateKey } from "./time";
import { useTz } from "./timezone";
import { track } from "./track";

const STORAGE_KEY = "mtc.leagueTab.v1";
const monthOf = (c: { y: number; m: number }) => `${c.y}-${String(c.m + 1).padStart(2, "0")}`;

// 리그 일정 탭: 리그를 고르면 그 리그의 월간 달력(날짜별 경기 수)과 고른 날의 경기·결과.
// target: 다른 화면에서 '이 리그·이 날짜로' 열 때 (같은 리그 다른 경기 → 리그 전체 일정)
export function LeagueCalendar({
  catalog,
  selections,
  todayKey,
  target,
}: {
  catalog: Catalog;
  selections: Selection[];
  todayKey: string;
  target: { comp: string; date: string } | null;
}) {
  const { m: t, t: fmt, intl, locale } = useI18n();
  const tz = useTz();
  const mine = useMemo(() => new Map(selections.map((s) => [s.slug, s.color])), [selections]);
  // 내 팀이 속한 대회를 앞에
  const comps = useMemo(() => {
    const my = new Set(selections.map((s) => catalog.teams.find((x) => x.slug === s.slug)?.competition).filter(Boolean));
    return [...catalog.competitions].sort((a, b) => Number(my.has(b.slug)) - Number(my.has(a.slug)));
  }, [catalog, selections]);

  const [comp, setComp] = useState<string>(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {
      // 저장소를 못 쓰면 내 팀 리그로
    }
    return target?.comp ?? (saved && comps.some((c) => c.slug === saved) ? saved : (comps[0]?.slug ?? ""));
  });
  const start = keyParts(target?.date ?? todayKey);
  const [cursor, setCursor] = useState({ y: start.y, m: start.m });
  const [selectedKey, setSelectedKey] = useState(target?.date ?? todayKey);
  // 사용자가 직접 고른 날짜면 달을 받아 와도 바꾸지 않는다
  const picked = useRef(!!target);
  const [matches, setMatches] = useState<ScheduleMatch[] | null>(null);
  const [failed, setFailed] = useState(false);
  const cache = useRef(new Map<string, ScheduleMatch[]>());

  useEffect(() => {
    if (!target) return;
    setComp(target.comp);
    const p = keyParts(target.date);
    setCursor({ y: p.y, m: p.m });
    setSelectedKey(target.date);
    picked.current = true;
  }, [target]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, comp);
    } catch {
      // 무시
    }
  }, [comp]);

  const month = monthOf(cursor);
  useEffect(() => {
    if (!comp) return;
    const key = `${comp}|${month}|${tz}|${locale}`;
    const hit = cache.current.get(key);
    if (hit) {
      setMatches(hit);
      return;
    }
    setMatches(null);
    setFailed(false);
    const ctrl = new AbortController();
    fetch(`/api/matches/league?comp=${comp}&month=${month}&tz=${encodeURIComponent(tz)}&lang=${locale}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { matches: ScheduleMatch[] }) => {
        cache.current.set(key, d.matches);
        setMatches(d.matches);
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setFailed(true);
      });
    return () => ctrl.abort();
  }, [comp, month, tz, locale]);

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduleMatch[]>();
    for (const x of matches ?? []) {
      const k = matchDateKey(x, tz);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(x);
    }
    return map;
  }, [matches, tz]);

  // 달을 받아 오면 보여 줄 날: 오늘(이 달이면)부터 가장 가까운 다음 경기일, 없으면 이 달의 마지막 경기일
  useEffect(() => {
    if (!matches || picked.current) return;
    const days = [...byDay.keys()].sort();
    const from = todayKey.startsWith(`${month}-`) ? todayKey : `${month}-01`;
    const next = days.find((d) => d >= from) ?? days[days.length - 1];
    setSelectedKey(next ?? from);
  }, [matches, byDay, month, todayKey]);

  const dayMatches = byDay.get(selectedKey) ?? [];
  const compName = comps.find((c) => c.slug === comp)?.name ?? comp;

  return (
    <section className="league-cal">
      <div className="records-tabs" role="tablist" aria-label={t.app.leagueTab}>
        {comps.map((c) => (
          <button
            key={c.slug}
            type="button"
            role="tab"
            aria-selected={c.slug === comp}
            className={`records-comp${c.slug === comp ? " on" : ""}`}
            onClick={() => {
              setComp(c.slug);
              picked.current = false;
              track("league_tab_pick");
            }}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="main-grid">
        <div>
          <MonthCalendar
            year={cursor.y}
            month={cursor.m}
            todayKey={todayKey}
            selectedKey={selectedKey}
            byDay={new Map()}
            teamShort={(s) => s}
            onSelectDay={(k) => {
              picked.current = true;
              setSelectedKey(k);
            }}
            onMove={(delta) => {
              picked.current = false;
              setCursor((c) => {
                const d = new Date(Date.UTC(c.y, c.m + delta, 1));
                return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
              });
            }}
            onToday={() => {
              const p = keyParts(todayKey);
              picked.current = true;
              setCursor({ y: p.y, m: p.m });
              setSelectedKey(todayKey);
            }}
            cell={(key) => {
              const list = byDay.get(key) ?? [];
              const color = list
                .flatMap((x) => [x.home, x.away])
                .map((s) => (s ? mine.get(s) : undefined))
                .find((c) => c != null);
              return {
                count: list.length,
                node: list.length ? (
                  <span className="lc-cell">
                    <span className="lc-count">{list.length}</span>
                    {color != null && <span className="dot" style={teamVars(color) as React.CSSProperties} />}
                  </span>
                ) : null,
              };
            }}
          />
        </div>
        <section className="card day-list" aria-live="polite">
          <h2>
            {dateLabel(selectedKey, intl)} <span className="muted small">{compName}</span>
          </h2>
          {failed && <p className="error">{t.app.loadError}</p>}
          {!failed && !matches && <p className="muted">{t.app.loading}</p>}
          {matches && dayMatches.length === 0 && <p className="muted">{t.app.noMatchesDay}</p>}
          {dayMatches.length > 0 && (
            <>
              <p className="muted small">{fmt(t.app.leagueDayCount, { n: dayMatches.length })}</p>
              <LeagueMatchList matches={dayMatches} mine={mine} />
            </>
          )}
          <a className="league-day-link" href={`/league/${comp}`}>
            {fmt(t.app.leaguePage, { league: compName })}
          </a>
        </section>
      </div>
    </section>
  );
}
