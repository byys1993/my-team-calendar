import type { ScheduleMatch } from "@/lib/schedule";

export type Outcome = "win" | "draw" | "loss";

// 내 팀 기준 결과. 끝나지 않았거나 점수가 없으면 null.
export function resultFor(m: ScheduleMatch, team: string): { mine: number; theirs: number; outcome: Outcome } | null {
  if (m.homeScore == null || m.awayScore == null) return null;
  if (m.home !== team && m.away !== team) return null;
  const isHome = m.home === team;
  const mine = isHome ? m.homeScore : m.awayScore;
  const theirs = isHome ? m.awayScore : m.homeScore;
  return { mine, theirs, outcome: mine > theirs ? "win" : mine < theirs ? "loss" : "draw" };
}
