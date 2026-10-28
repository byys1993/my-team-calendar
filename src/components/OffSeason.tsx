"use client";

import { useI18n } from "@/i18n/client";
import type { ScheduleMatch } from "@/lib/schedule";
import { MatchResult } from "./spoiler";
import { dateLabel, matchDateKey } from "./time";
import { useTz } from "./timezone";

// 리그별 새 시즌이 보통 시작하는 달 (비시즌 안내용 어림값)
const SEASON_START_MONTH: Record<string, number> = {
  kbo: 3,
  "k-league-1": 2,
  "k-league-2": 3,
  kbl: 10,
  lck: 1,
  epl: 8,
  laliga: 8,
  bundesliga: 8,
  "serie-a": 8,
  "ligue-1": 8,
  nba: 10,
  nhl: 10,
  mlb: 3,
  nfl: 9,
  f1: 3,
};

// 예정 경기가 없는 팀의 카드: 시즌이 끝났으면 마지막 경기와 다음 시즌 시작 시기를 보여 준다
export function OffSeason({
  team,
  last,
  competition,
  opponentName,
}: {
  team: string;
  last: ScheduleMatch | undefined;
  competition: string | null;
  opponentName: (slug: string) => string;
}) {
  const { m, t: fmt, intl } = useI18n();
  const tz = useTz();
  const month = competition ? SEASON_START_MONTH[competition] : undefined;
  const monthName = month ? new Intl.DateTimeFormat(intl, { month: "long" }).format(new Date(Date.UTC(2026, month - 1, 15))) : null;
  const opponent = last ? (last.home === team ? last.away : last.home) : null;
  return (
    <div className="offseason">
      <div className="offseason-title">{last ? m.offseason.title : m.app.noNext}</div>
      {last && (
        <div className="offseason-last">
          {m.offseason.last} · {dateLabel(matchDateKey(last, tz), intl)}
          {opponent && ` ${m.match.vs} ${opponentName(opponent)}`} <MatchResult match={last} team={team} />
        </div>
      )}
      <div className="muted offseason-next">{monthName ? fmt(m.offseason.next, { month: monthName }) : m.offseason.nextGeneric}</div>
    </div>
  );
}
