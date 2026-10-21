import type { MatchStatus } from "@/collector/types";

export const STATUS_LABEL_ADMIN: Record<MatchStatus, string> = {
  scheduled: "확정",
  time_tbd: "시간 미정",
  conditional: "진출 시",
  draw_pending: "대진 추첨 대기",
  postponed: "연기",
  cancelled: "취소",
};
