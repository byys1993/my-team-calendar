import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { createMemoryDb } from "@/lib/db/pglite";
import { migrate } from "@/lib/db/migrate";
import { getStats, isVisitorId, recordVisit, seoulDay } from "@/lib/visitors";

let db: Db & { close(): Promise<void> };
beforeEach(async () => {
  db = await createMemoryDb();
  await migrate(db);
});
afterEach(() => db.close());

const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";
const at = (iso: string) => new Date(`${iso}+09:00`); // 서울 시각

describe("방문자 수", () => {
  it("접속 중(2분), 오늘(한국 날짜), 전체(날짜별 합)", async () => {
    await recordVisit(db, A, at("2026-10-22T10:00:00"));
    await recordVisit(db, A, at("2026-10-22T10:01:00")); // 같은 사람 신호
    expect(await recordVisit(db, B, at("2026-10-22T10:01:30"))).toEqual({ online: 2, today: 2, total: 2 });
    // A 가 3분 넘게 신호가 없으면 접속 중에서 빠진다
    expect(await getStats(db, at("2026-10-22T10:04:30"))).toEqual({ online: 0, today: 2, total: 2 });
    expect(await getStats(db, at("2026-10-22T10:03:00"))).toMatchObject({ online: 1 });
    // 한국 시간 자정이 지나면 오늘은 새로, 전체는 더해진다
    expect(await recordVisit(db, A, at("2026-10-23T00:05:00"))).toEqual({ online: 1, today: 1, total: 3 });
  });

  it("ID 모양 검증과 한국 날짜", () => {
    expect(isVisitorId(A)).toBe(true);
    expect(isVisitorId("short")).toBe(false);
    expect(isVisitorId("<script>alert(1)</script>xxxxxxxx")).toBe(false);
    expect(seoulDay(new Date("2026-10-22T15:30:00Z"))).toBe("2026-10-23");
  });
});
