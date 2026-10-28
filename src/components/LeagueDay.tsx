"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";
import { formatLabel } from "@/i18n/format";
import type { ScheduleMatch } from "@/lib/schedule";
import { isTentative } from "./matchView";
import { ScoreResult } from "./spoiler";
import { isDawn, matchTimeLabel } from "./time";
import { useTz } from "./timezone";
import { track } from "./track";

// 날짜 패널 아래 '같은 리그 다른 경기 ▸': 그날 내 팀이 뛴 대회의 다른 경기. 처음엔 접혀 있고, 펼칠 때 받아 온다.
// competitions: 보여 줄 대회(내 팀 경기 순서), excludeIds: 이미 내 목록에 있는 경기
export function LeagueDay({
  competitions,
  dateKey,
  excludeIds,
  competitionName,
}: {
  competitions: string[];
  dateKey: string;
  excludeIds: Set<string>;
  competitionName: (slug: string) => string;
}) {
  const { m: t, t: fmt, intl, locale } = useI18n();
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
  const label = (s: string) => formatLabel(s, t) ?? s;

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
                  {list.length > 0 && (
                    <ul className="league-day-list">
                      {list.map((x) => {
                        const status = x.status === "scheduled" ? null : t.status[x.status];
                        const round = formatLabel(x.roundLabel, t);
                        return (
                          <li key={x.id} className={isTentative(x) ? "tentative" : undefined}>
                            <span className="ld-time">
                              {isDawn(x, tz) && "🌙"}
                              {matchTimeLabel(x, intl, t.match.timeTbd, tz)}
                            </span>
                            <span className="ld-what">
                              <span className="ld-teams">
                                {label(x.homeLabel)} {t.match.vs} {label(x.awayLabel)}
                              </span>
                              {status && <span className="status">{status}</span>}
                              <ScoreResult match={x} />
                              {round && <span className="ld-meta muted">{round}</span>}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <a className="league-day-link" href={`/league/${c}`}>
                    {competitions.length > 1 ? `${competitionName(c)} · ` : ""}
                    {t.app.leagueAll}
                  </a>
                </section>
              );
            })}
        </div>
      )}
    </div>
  );
}
