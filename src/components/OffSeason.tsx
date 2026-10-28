"use client";

import { useI18n } from "@/i18n/client";
import { formatLabel } from "@/i18n/format";
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

// 예정 경기가 없는 팀의 카드: 마지막 경기와 다음 시즌 시작 시기를 보여 준다.
// 마지막 경기를 치른 대회(월즈·포스트시즌 등)에 아직 남은 경기가 있으면 '시즌 종료' 대신 '○○ 진행 중' (다음 대진이 아직 안 정해진 것일 수 있다)
export function OffSeason({
  team,
  last,
  competition,
  ongoingName,
}: {
  team: string;
  last: ScheduleMatch | undefined;
  competition: string | null;
  ongoingName: (competition: string) => string | null; // 진행 중인 대회면 그 이름
}) {
  const { m, t: fmt, intl } = useI18n();
  const tz = useTz();
  const month = competition ? SEASON_START_MONTH[competition] : undefined;
  const monthName = month ? new Intl.DateTimeFormat(intl, { month: "long" }).format(new Date(Date.UTC(2026, month - 1, 15))) : null;
  // 상대 이름은 경기에 저장된 이름 (팀 목록에 없는 해외 팀도 이름이 나오도록)
  const opponent = last && !(last.title && !last.away) ? formatLabel(last.home === team ? last.awayLabel : last.homeLabel, m) : null;
  const ongoing = last ? ongoingName(last.competition) : null;
  return (
    <div className="offseason">
      <div className="offseason-title">
        {ongoing ? fmt(m.offseason.ongoing, { league: ongoing }) : last ? m.offseason.title : m.app.noNext}
      </div>
      {last && (
        <div className="offseason-last">
          {m.offseason.last} · {dateLabel(matchDateKey(last, tz), intl)}
          {opponent && ` ${m.match.vs} ${opponent}`} <MatchResult match={last} team={team} />
        </div>
      )}
      <div className="muted offseason-next">
        {ongoing
          ? `${m.offseason.ongoingNext}${monthName ? ` ${fmt(m.offseason.ongoingOut, { month: monthName })}` : ""}`
          : monthName
            ? fmt(m.offseason.next, { month: monthName })
            : m.offseason.nextGeneric}
      </div>
    </div>
  );
}
