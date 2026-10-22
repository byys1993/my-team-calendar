import type { Db } from "@/lib/db";

// 더 이상 필요 없는 기록을 지운다 (매시간 알림 발송 때 함께 실행). 개인정보는 필요 없어지면 바로 지운다는 원칙.
// - 만료된 로그인 세션
// - 로그인 코드: 마지막 발송 후 하루 지난 것 (그 사이에는 발송 횟수 제한에 쓰인다)
// - 요청 제한 기록: 하루 지난 것 (가장 긴 제한 창이 1시간)
// - 접속 중 기록: 하루 지난 것 (오늘·전체 방문자 수는 따로 남는다)
export interface CleanupResult {
  sessions: number;
  loginCodes: number;
  rateLimits: number;
  presence: number;
}

export async function cleanupExpired(db: Db, now = new Date()): Promise<CleanupResult> {
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const count = async (sql: string, params: unknown[]) => (await db.query(`${sql} returning 1`, params)).length;
  return {
    sessions: await count("delete from user_session where expires_at < $1", [now.toISOString()]),
    loginCodes: await count("delete from login_code where last_sent_at < $1", [dayAgo]),
    rateLimits: await count("delete from rate_limit where window_start < $1", [dayAgo]),
    presence: await count("delete from visitor_presence where last_seen < $1", [dayAgo]),
  };
}
