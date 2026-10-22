import type { ScheduleMatch } from "@/lib/schedule";
import { PALETTE, type Selection } from "./selection";

// 확정 경기가 아니면 화면에서 점선·흐린 색으로 구분한다
export const isTentative = (m: ScheduleMatch) => m.status !== "scheduled";

// 상대가 없는 이벤트형 경기 (F1 세션 등)
export const isEvent = (m: ScheduleMatch) => !!m.title && !m.away;

export type Side = "home" | "away" | "neutral" | "vs";

export interface MatchView {
  match: ScheduleMatch;
  team: string; // 이 경기를 보여주는 기준 팀 (선택 순서상 먼저인 팀)
  color: string;
  // 이벤트형(F1)이면 null, 홈·원정이 없는 e스포츠는 'vs' (배지 없이 'vs 상대')
  side: Side | null;
  opponent: string; // 화면 언어로 바꾼 상대 이름, 이벤트형이면 제목
}

// 저장된 토큰('@tbd', '@f1:...')을 화면 언어로 바꾸는 함수들 (CalendarApp 이 넘겨준다)
export interface Display {
  label(raw: string): string;
  title(raw: string): string;
}

// 켜져 있는 선택 팀 기준으로 경기를 보여줄 관점을 정한다. 해당 팀이 모두 꺼져 있으면 null
export function viewOf(m: ScheduleMatch, selections: Selection[], display: Display, onlyEnabled = true): MatchView | null {
  for (const s of selections) {
    if (onlyEnabled && !s.enabled) continue;
    if (m.home !== s.slug && m.away !== s.slug) continue;
    if (isEvent(m)) {
      return { match: m, team: s.slug, color: PALETTE[s.color], side: null, opponent: display.title(m.title!) };
    }
    const isHome = m.home === s.slug;
    return {
      match: m,
      team: s.slug,
      color: PALETTE[s.color],
      // e스포츠는 홈·원정이 없으니 'vs 상대'만 보여준다
      side: m.sport === "esports" ? "vs" : m.isNeutral ? "neutral" : isHome ? "home" : "away",
      opponent: display.label(isHome ? m.awayLabel : m.homeLabel),
    };
  }
  return null;
}
