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

describe("캘린더 구독 수", () => {
  it("같은 팀 조합·언어는 하나로 세고, 최근 7일 안에 불린 주소만 '구독 중'으로 센다", async () => {
    const { recordIcsFetch, getIcsStats } = await import("@/lib/icsStats");
    await recordIcsFetch(db, ["kbo-kia", "tottenham"], "ko", at("2026-10-01T10:00:00"));
    await recordIcsFetch(db, ["tottenham", "kbo-kia"], "ko", at("2026-10-20T10:00:00"));
    await recordIcsFetch(db, ["tottenham"], "en", at("2026-10-21T10:00:00"));
    expect(await getIcsStats(db, at("2026-10-22T10:00:00"))).toEqual({ active7d: 2, total: 2 });
    expect(await getIcsStats(db, at("2026-10-28T09:00:00"))).toEqual({ active7d: 1, total: 2 });
  });
});

describe("핵심 행동 세기", () => {
  it("같은 사람·같은 날·같은 행동은 한 번, 기간별로 '한 번이라도 한 사람' 수", async () => {
    const { recordEvent, funnel } = await import("@/lib/events");
    await recordVisit(db, A, at("2026-10-20T10:00:00"));
    await recordVisit(db, B, at("2026-10-22T10:00:00"));
    await recordEvent(db, A, "team_pick", at("2026-10-20T10:01:00"));
    await recordEvent(db, A, "team_pick", at("2026-10-20T10:05:00"));
    await recordEvent(db, A, "team_pick", at("2026-10-21T10:05:00"));
    await recordEvent(db, B, "sub_open", at("2026-10-22T10:01:00"));
    const f = await funnel(db, 7, at("2026-10-22T12:00:00"));
    expect(f.visitors).toBe(2);
    expect(f.events.team_pick).toBe(1);
    expect(f.events.sub_open).toBe(1);
    expect(f.events.notify_on).toBe(0);
    // 1일 기간이면 오늘(22일)만
    expect((await funnel(db, 1, at("2026-10-22T12:00:00"))).events.team_pick).toBe(0);
  });
});
