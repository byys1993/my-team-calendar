import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hitRateLimit, issueCode, userFromToken, verifyCode } from "@/lib/auth/core";
import { cleanupExpired } from "@/lib/cleanup";
import type { Db } from "@/lib/db";
import { createMemoryDb } from "@/lib/db/pglite";
import { migrate } from "@/lib/db/migrate";
import { getStats, recordVisit } from "@/lib/visitors";

let db: Db & { close(): Promise<void> };
beforeEach(async () => {
  db = await createMemoryDb();
  await migrate(db);
});
afterEach(() => db.close());

const t0 = new Date("2026-10-01T00:00:00Z");
const later = (days: number) => new Date(t0.getTime() + days * 86_400_000);

describe("오래된 기록 정리", () => {
  it("만료 세션·지난 코드·요청 제한·접속 기록만 지우고, 방문자 수와 유효 세션은 남긴다", async () => {
    const { code } = (await issueCode(db, "fan@example.com", t0)) as { code: string };
    const r = await verifyCode(db, "fan@example.com", code, t0);
    if (!r.ok) throw new Error("login failed");
    await db.query("insert into user_session (token_hash, user_id, expires_at) values ('old', $1, $2)", [r.user.id, later(1).toISOString()]);
    await hitRateLimit(db, "code-ip:1.2.3.4", 10, 3600, t0);
    await recordVisit(db, "aaaaaaaa-1111-4111-8111-111111111111", t0);

    const out = await cleanupExpired(db, later(2));
    expect(out).toEqual({ sessions: 1, loginCodes: 1, rateLimits: 1, presence: 1 });
    // 180일짜리 로그인 세션은 그대로
    expect((await userFromToken(db, r.token, later(2)))?.email).toBe("fan@example.com");
    expect(await getStats(db, t0)).toMatchObject({ today: 1, total: 1 });
    // 다시 돌려도 지울 것이 없다
    expect(await cleanupExpired(db, later(2))).toEqual({ sessions: 0, loginCodes: 0, rateLimits: 0, presence: 0 });
  });
});
