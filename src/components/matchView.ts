import type { ScheduleMatch } from "@/lib/schedule";
import { PALETTE, type Selection } from "./selection";

export const STATUS_LABEL: Record<ScheduleMatch["status"], string | null> = {
  scheduled: null,
  time_tbd: "시간 미정",
  conditional: "진출 시",
  draw_pending: "대진 추첨 대기",
  postponed: "연기",
  cancelled: "취소",
};

// 확정 경기가 아니면 화면에서 점선·흐린 색으로 구분한다
export const isTentative = (m: ScheduleMatch) => m.status !== "scheduled";

// 상대가 없는 이벤트형 경기 (F1 세션 등)
export const isEvent = (m: ScheduleMatch) => !!m.title && !m.away;

export interface MatchView {
  match: ScheduleMatch;
  team: string; // 이 경기를 보여주는 기준 팀 (선택 순서상 먼저인 팀)
  color: string;
  side: "홈" | "원정" | "중립" | null; // 이벤트형이면 null
  opponent: string; // 이벤트형이면 제목
}

// 켜져 있는 선택 팀 기준으로 경기를 보여줄 관점을 정한다. 해당 팀이 모두 꺼져 있으면 null
export function viewOf(m: ScheduleMatch, selections: Selection[], onlyEnabled = true): MatchView | null {
  for (const s of selections) {
    if (onlyEnabled && !s.enabled) continue;
    if (m.home !== s.slug && m.away !== s.slug) continue;
    if (isEvent(m)) return { match: m, team: s.slug, color: PALETTE[s.color], side: null, opponent: m.title! };
    const isHome = m.home === s.slug;
    return {
      match: m,
      team: s.slug,
      color: PALETTE[s.color],
      side: m.isNeutral ? "중립" : isHome ? "홈" : "원정",
      opponent: isHome ? m.awayLabel : m.homeLabel,
    };
  }
  return null;
}
