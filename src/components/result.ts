import type { ScheduleMatch } from "@/lib/schedule";

export type Outcome = "win" | "draw" | "loss";

export interface TeamResult {
  mine: number;
  theirs: number;
  outcome: Outcome;
  pen?: { mine: number; theirs: number }; // 승부차기로 끝난 경기
}

// 내 팀 기준 결과. 끝나지 않았거나 점수가 없으면 null.
// 정규·연장이 비기고 승부차기로 갈렸으면 점수는 그대로 두고 승패는 승부차기로 정한다.
export function resultFor(m: ScheduleMatch, team: string): TeamResult | null {
  if (m.homeScore == null || m.awayScore == null) return null;
  if (m.home !== team && m.away !== team) return null;
  const isHome = m.home === team;
  const mine = isHome ? m.homeScore : m.awayScore;
  const theirs = isHome ? m.awayScore : m.homeScore;
  if (mine === theirs && m.homePen != null && m.awayPen != null && m.homePen !== m.awayPen) {
    const pen = { mine: isHome ? m.homePen : m.awayPen, theirs: isHome ? m.awayPen : m.homePen };
    return { mine, theirs, outcome: pen.mine > pen.theirs ? "win" : "loss", pen };
  }
  return { mine, theirs, outcome: mine > theirs ? "win" : mine < theirs ? "loss" : "draw" };
}
