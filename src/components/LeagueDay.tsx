"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { ScheduleMatch } from "@/lib/schedule";
import { LeagueMatchList } from "./LeagueMatchList";
import { useTz } from "./timezone";
import { track } from "./track";

// 날짜 패널 아래 '같은 리그 다른 경기 ▸': 그날 내 팀이 뛴 대회의 다른 경기. 처음엔 접혀 있고, 펼칠 때 받아 온다.
// 맨 아래 '리그 전체 일정 →' 은 리그 일정 탭을 그 리그·그 날짜로 연다
// competitions: 보여 줄 대회(내 팀 경기 순서), excludeIds: 이미 내 목록에 있는 경기
export function LeagueDay({
  competitions,
  dateKey,
  excludeIds,
  competitionName,
  onOpenLeague,
}: {
  competitions: string[];
  dateKey: string;
  excludeIds: Set<string>;
  competitionName: (slug: string) => string;
  onOpenLeague: (competition: string) => void; // 리그 일정 탭에서 이 리그·이 날짜로
}) {
  const { m: t, t: fmt, locale } = useI18n();
  const tz = useTz();
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState<ScheduleMatch[] | null>(null);
  const [failed, setFailed] = useState(false);
  const comps = competitions.join(",");

  useEffect(() => {
    if (!open || matches) return;
    const ctrl = new AbortController();
    setFailed(false);
    fetch(`/api/matches/day?comps=${encodeURIComponent(comps)}&date=${dateKey}&tz=${encodeURIComponent(tz)}&lang=${locale}`, {
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { matches: ScheduleMatch[] }) => setMatches(d.matches))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setFailed(true);
      });
    return () => ctrl.abort();
  }, [open, matches, comps, dateKey, tz, locale]);

  const others = matches?.filter((x) => !excludeIds.has(x.id)) ?? null;

  return (
    <div className="league-day">
      <button
        type="button"
        className="league-day-toggle"
        aria-expanded={open}
        onClick={() => {
          if (!open) track("league_day_open");
          setOpen(!open);
        }}
      >
        {others ? fmt(t.app.otherGamesCount, { n: others.length }) : t.app.otherGames} <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="league-day-body">
          {failed && <p className="error">{t.app.loadError}</p>}
          {!failed && !others && <p className="muted">{t.app.loading}</p>}
          {others && others.length === 0 && <p className="muted">{t.app.noOtherGames}</p>}
          {others &&
            competitions.map((c) => {
              const list = others.filter((x) => x.competition === c);
              return (
                <section key={c} className="league-day-group">
                  {competitions.length > 1 && <h3>{competitionName(c)}</h3>}
                  {list.length > 0 && <LeagueMatchList matches={list} />}
                  <button type="button" className="league-day-link" onClick={() => onOpenLeague(c)}>
                    {competitions.length > 1 ? `${competitionName(c)} · ` : ""}
                    {t.app.leagueAll}
                  </button>
                </section>
              );
            })}
        </div>
      )}
    </div>
  );
}
