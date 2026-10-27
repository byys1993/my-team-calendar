import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertMatches } from "@/collector/upsert";
import { issueCode, unsubscribe, unsubscribeSig, updateUser, verifyCode } from "@/lib/auth/core";
import { isDue, runNotifications, zonedHourToUtc, type OutgoingEmail } from "@/lib/notify";
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

  it("정한 시각부터 24시간 안의 경기를 하루 한 번 보내고, 경기가 없으면 보내지 않는다", async () => {
    const sent: OutgoingEmail[] = [];
    const send = async (e: OutgoingEmail[]) => void sent.push(...e);
    const opts = { siteUrl: "https://example.com" };

    const r1 = await runNotifications(db, send, { ...opts, now: seoul("2026-10-24T09:10:00") });
    expect(r1).toMatchObject({ sent: 1, empty: 0 });
    expect(sent[0].to).toBe("fan@example.com");
    expect(sent[0].subject).toContain("앞으로 24시간 경기 1개 · 10월 24일 (토)");
    // 내 팀을 앞에, 홈·원정 표시
    expect(sent[0].text).toContain("23:00  아스널 vs 에버턴 (홈)");
    expect(sent[0].text).toContain("프리미어리그");
    expect(sent[0].unsubscribeUrl).toBe(`https://example.com/unsubscribe?u=${userId}&s=${unsubscribeSig(userId)}`);

    // 같은 날 다시 돌려도 안 보낸다
    expect((await runNotifications(db, send, { ...opts, now: seoul("2026-10-24T10:10:00") })).sent).toBe(0);
    // 다음 날(25일 9시 ~ 26일 9시) 경기 없음 → 보내지 않는다
    expect(await runNotifications(db, send, { ...opts, now: seoul("2026-10-25T09:10:00") })).toMatchObject({ sent: 0, empty: 1 });
    // 27일 새벽 4시 경기는 26일 아침 메일에 미리 들어간다
    expect((await runNotifications(db, send, { ...opts, now: seoul("2026-10-26T09:10:00") })).sent).toBe(1);
    expect(sent[1].text).toContain("[10월 27일 (화)]\n04:00  아스널 vs 맨체스터 시티 (원정)");
    // 27일 아침에는 이미 끝난 새벽 경기를 다시 보내지 않는다
    expect(await runNotifications(db, send, { ...opts, now: seoul("2026-10-27T09:10:00") })).toMatchObject({ sent: 0, empty: 1 });
    expect(sent).toHaveLength(2);
  });

  it("메일이 늦게 가면 그 사이 이미 시작한 경기는 뺀다", async () => {
    const r = await runNotifications(db, async () => {}, { siteUrl: "https://x", now: seoul("2026-10-24T23:30:00") });
    expect(r).toMatchObject({ sent: 0, empty: 1 });
  });

  it("시간대의 정한 시각을 UTC 로 (서머타임 끝나는 날 포함)", () => {
    expect(zonedHourToUtc("2026-10-24", 9, "Asia/Seoul").toISOString()).toBe("2026-10-24T00:00:00.000Z");
    expect(zonedHourToUtc("2026-10-31", 9, "America/New_York").toISOString()).toBe("2026-10-31T13:00:00.000Z");
    expect(zonedHourToUtc("2026-11-01", 9, "America/New_York").toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });

  it("매주 알림은 월요일에 7일 치를 날짜별로 묶어 보낸다", async () => {
    await updateUser(db, userId, { notifyMode: "weekly" });
    const sent: OutgoingEmail[] = [];
    await runNotifications(db, async (e) => void sent.push(...e), { siteUrl: "https://x", now: seoul("2026-10-26T09:00:00") });
    expect(sent).toHaveLength(1);
    // 10/27 04:00 경기만 (11/5 는 7일 밖, 10/24 는 지남)
    expect(sent[0].subject).toContain("이번 주 경기 1개 · 10월 26일 (월)부터");
    expect(sent[0].text).toContain("[10월 27일 (화)]\n04:00  아스널 vs 맨체스터 시티 (원정)");
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

describe("동시 호출", () => {
  let db2: Db & { close(): Promise<void> };
  afterEach(() => db2?.close());

  it("두 곳에서 동시에 불러도 한 통만 보내고, 발송이 실패하면 다음에 다시 보낸다", async () => {
    const { db: d, eplId } = (await setupDb()) as { db: Db & { close(): Promise<void> }; eplId: number };
    db2 = d;
    await upsertMatches(d, eplId, "espn", [
      espnMatch({ externalId: "1", startAt: "2026-10-24T14:00:00Z", home: { externalId: "359", name: "Arsenal" }, away: { externalId: "368", name: "Everton" } }),
    ]);
    const { code } = (await issueCode(d, "two@example.com")) as { code: string };
    const r = await verifyCode(d, "two@example.com", code);
    if (!r.ok) throw new Error("login failed");
    await updateUser(d, r.user.id, { selections: [{ slug: "arsenal", color: 0, enabled: true }], timeZone: "Asia/Seoul", notifyMode: "daily" });

    const now = new Date("2026-10-24T09:10:00+09:00");
    // 발송 실패 → 표시가 되돌려져 다음 실행에서 다시 보낸다
    await expect(runNotifications(d, async () => Promise.reject(new Error("resend down")), { siteUrl: "https://x", now })).rejects.toThrow();
    const sent: OutgoingEmail[] = [];
    const send = async (e: OutgoingEmail[]) => {
      await new Promise((ok) => setTimeout(ok, 20));
      sent.push(...e);
    };
    const [a, b] = await Promise.all([
      runNotifications(d, send, { siteUrl: "https://x", now }),
      runNotifications(d, send, { siteUrl: "https://x", now }),
    ]);
    expect(sent).toHaveLength(1);
    expect(a.sent + b.sent).toBe(1);
  });
});
