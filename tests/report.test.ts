import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueCode, updateUser, verifyCode } from "@/lib/auth/core";
import type { Db } from "@/lib/db";
import { recordEvent } from "@/lib/events";
import { recordIcsFetch } from "@/lib/icsStats";
import { buildWeeklyReport, markWeeklyReportSent, weeklyReportDue } from "@/lib/report";
import { recordVisit } from "@/lib/visitors";
import { setupDb } from "./helpers";

let db: Db & { close(): Promise<void> };
beforeEach(async () => {
  ({ db } = (await setupDb()) as { db: Db & { close(): Promise<void> } });
});
afterEach(() => db.close());

const seoul = (iso: string) => new Date(`${iso}+09:00`);
const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";

describe("주간 운영 리포트", () => {
  it("이용 흐름·전주 대비·규모·인기 팀을 담는다", async () => {
    // 지난주(10/19~25): 방문 2, 팀 선택 1, 구독 1 / 그 전 주: 방문 1
    await recordVisit(db, A, seoul("2026-10-13T10:00:00"));
    await recordVisit(db, A, seoul("2026-10-20T10:00:00"));
    await recordVisit(db, B, seoul("2026-10-22T10:00:00"));
    await recordEvent(db, A, "team_pick", seoul("2026-10-20T10:01:00"));
    await recordEvent(db, A, "sub_apple", seoul("2026-10-20T10:02:00"));
    await recordIcsFetch(db, ["arsenal", "everton"], "ko", seoul("2026-10-24T10:00:00"));
    const { code } = (await issueCode(db, "fan@example.com")) as { code: string };
    const r = await verifyCode(db, "fan@example.com", code);
    if (!r.ok) throw new Error("login");
    await updateUser(db, r.user.id, { selections: [{ slug: "arsenal", color: 0, enabled: true }], notifyMode: "daily" });

    const rep = await buildWeeklyReport(db, "https://x", seoul("2026-10-26T09:05:00"));
    expect(rep.subject).toContain("방문 2명 · 팀 선택 1명 · 구독 1명");
    expect(rep.text).toContain("방문: 2명 · 100% (+1)");
    expect(rep.text).toContain("캘린더 구독 버튼: 1명 · 50% (+1)");
    expect(rep.text).toContain("캘린더 구독 주소: 최근 7일 1개");
    expect(rep.text).toContain("알림 메일 켬 1명");
    expect(rep.text).toContain("1. 아스널 (2)");
    expect(rep.text).toContain("Claude");
  });

  it("확인할 일은 정해진 기간의 리포트에만 나온다", async () => {
    const text = async (day: string) => (await buildWeeklyReport(db, "https://x", seoul(`${day}T09:05:00`))).text;
    expect(await text("2026-11-02")).not.toContain("이번 주 확인할 일");
    const naver = await text("2026-11-09");
    expect(naver).toContain("이번 주 확인할 일");
    expect(naver).toContain("네이버 서치어드바이저");
    expect(naver).not.toContain("Search Console");
    const both = await text("2026-11-16");
    expect(both).toContain("네이버 서치어드바이저");
    expect(both).toContain("Search Console");
    expect(await text("2026-11-30")).toContain("Search Console");
    expect(await text("2026-12-07")).not.toContain("이번 주 확인할 일");
  });

  it("월요일 9시 이후 한 번만", async () => {
    expect(await weeklyReportDue(db, seoul("2026-10-26T08:59:00"))).toBe(false); // 월요일 9시 전
    expect(await weeklyReportDue(db, seoul("2026-10-27T10:00:00"))).toBe(false); // 화요일
    expect(await weeklyReportDue(db, seoul("2026-10-26T09:10:00"))).toBe(true);
    await markWeeklyReportSent(db, seoul("2026-10-26T09:10:00"));
    expect(await weeklyReportDue(db, seoul("2026-10-26T09:20:00"))).toBe(false);
    expect(await weeklyReportDue(db, seoul("2026-11-02T09:00:00"))).toBe(true); // 다음 주 월요일
  });
});
