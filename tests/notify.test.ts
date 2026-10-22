import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertMatches } from "@/collector/upsert";
import { issueCode, unsubscribe, unsubscribeSig, updateUser, verifyCode } from "@/lib/auth/core";
import { isDue, runNotifications, type OutgoingEmail } from "@/lib/notify";
import type { Db } from "@/lib/db";
import { espnMatch, setupDb } from "./helpers";

let db: Db & { close(): Promise<void> };
let eplId: number;
let userId: string;

beforeEach(async () => {
  ({ db, eplId } = (await setupDb()) as { db: Db & { close(): Promise<void> }; eplId: number });
  await upsertMatches(db, eplId, "espn", [
    // 서울 10/24(토) 23:00, 10/27(화) 04:00, 11/5
    espnMatch({ externalId: "1", startAt: "2026-10-24T14:00:00Z", home: { externalId: "359", name: "Arsenal" }, away: { externalId: "368", name: "Everton" } }),
    espnMatch({ externalId: "2", startAt: "2026-10-26T19:00:00Z", home: { externalId: "382", name: "Man City" }, away: { externalId: "359", name: "Arsenal" } }),
    espnMatch({ externalId: "3", startAt: "2026-11-05T19:00:00Z", home: { externalId: "359", name: "Arsenal" }, away: { externalId: "382", name: "Man City" } }),
  ]);
  const { code } = (await issueCode(db, "fan@example.com")) as { code: string };
  const r = await verifyCode(db, "fan@example.com", code);
  if (!r.ok) throw new Error("login failed");
  userId = r.user.id;
  await updateUser(db, userId, {
    selections: [{ slug: "arsenal", color: 0, enabled: true }],
    locale: "ko",
    timeZone: "Asia/Seoul",
    notifyMode: "daily",
    notifyHour: 9,
  });
});
afterEach(() => db.close());

// 서울 시각으로 Date 만들기
const seoul = (iso: string) => new Date(`${iso}+09:00`);

describe("경기 알림 메일", () => {
  it("보낼 차례: 정한 시각 이후, 하루 한 번, 매주는 월요일만", () => {
    const u = { notifyMode: "daily" as const, notifyHour: 9, lastNotifiedOn: null };
    expect(isDue(u, seoul("2026-10-24T08:59:00"), "Asia/Seoul")).toBe(false);
    expect(isDue(u, seoul("2026-10-24T09:05:00"), "Asia/Seoul")).toBe(true);
    expect(isDue({ ...u, lastNotifiedOn: "2026-10-24" }, seoul("2026-10-24T15:00:00"), "Asia/Seoul")).toBe(false);
    // 서울 20시는 뉴욕 아침 7시라 아직 아니다
    expect(isDue(u, seoul("2026-10-24T20:00:00"), "America/New_York")).toBe(false);
    expect(isDue(u, seoul("2026-10-24T22:00:00"), "America/New_York")).toBe(true);
    const w = { ...u, notifyMode: "weekly" as const };
    expect(isDue(w, seoul("2026-10-24T10:00:00"), "Asia/Seoul")).toBe(false); // 토요일
    expect(isDue(w, seoul("2026-10-26T10:00:00"), "Asia/Seoul")).toBe(true); // 월요일
  });

  it("경기 있는 날 아침에 한 번 보내고, 경기 없는 날은 보내지 않는다", async () => {
    const sent: OutgoingEmail[] = [];
    const send = async (e: OutgoingEmail[]) => void sent.push(...e);
    const opts = { siteUrl: "https://example.com" };

    const r1 = await runNotifications(db, send, { ...opts, now: seoul("2026-10-24T09:10:00") });
    expect(r1).toMatchObject({ sent: 1, empty: 0 });
    expect(sent[0].to).toBe("fan@example.com");
    expect(sent[0].subject).toContain("오늘 경기 1개");
    expect(sent[0].text).toContain("23:00  아스널 vs 에버턴");
    expect(sent[0].text).toContain("프리미어리그");
    expect(sent[0].unsubscribeUrl).toBe(`https://example.com/unsubscribe?u=${userId}&s=${unsubscribeSig(userId)}`);

    // 같은 날 다시 돌려도 안 보낸다
    expect((await runNotifications(db, send, { ...opts, now: seoul("2026-10-24T10:10:00") })).sent).toBe(0);
    // 다음 날(경기 없음)은 보내지 않는다
    expect(await runNotifications(db, send, { ...opts, now: seoul("2026-10-25T09:10:00") })).toMatchObject({ sent: 0, empty: 1 });
    expect(sent).toHaveLength(1);
  });

  it("매주 알림은 월요일에 7일 치를 날짜별로 묶어 보낸다", async () => {
    await updateUser(db, userId, { notifyMode: "weekly" });
    const sent: OutgoingEmail[] = [];
    await runNotifications(db, async (e) => void sent.push(...e), { siteUrl: "https://x", now: seoul("2026-10-26T09:00:00") });
    expect(sent).toHaveLength(1);
    // 10/27 04:00 경기만 (11/5 는 7일 밖, 10/24 는 지남)
    expect(sent[0].subject).toContain("이번 주 경기 1개");
    expect(sent[0].text).toContain("[10월 27일 (화)]\n04:00  맨체스터 시티 vs 아스널");
  });

  it("수신 거부 링크는 서명이 맞아야 하고, 끄면 더 보내지 않는다", async () => {
    expect(await unsubscribe(db, userId, "wrong")).toBe(false);
    expect(await unsubscribe(db, userId, unsubscribeSig(userId))).toBe(true);
    const r = await runNotifications(db, async () => {}, { siteUrl: "https://x", now: seoul("2026-10-24T09:10:00") });
    expect(r).toMatchObject({ checked: 0, sent: 0 });
  });

  it("발송 한도를 넘으면 다음 실행으로 미룬다", async () => {
    const r = await runNotifications(db, async () => {}, { siteUrl: "https://x", now: seoul("2026-10-24T09:10:00"), maxPerRun: 0 });
    expect(r).toMatchObject({ sent: 0, deferred: 1 });
    const again = await runNotifications(db, async () => {}, { siteUrl: "https://x", now: seoul("2026-10-24T10:10:00") });
    expect(again.sent).toBe(1);
  });
});
