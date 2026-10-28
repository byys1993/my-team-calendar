import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertMatches } from "@/collector/upsert";
import type { Db } from "@/lib/db";
import { seed } from "@/lib/db/seed";
import { getLeaguePage, isLeagueQueryValid } from "@/lib/pages";
import { getCompetitionsDay } from "@/lib/schedule";
import { espnMatch, setupDb } from "./helpers";

let db: Db & { close(): Promise<void> };
let eplId: number;
const m = (id: string, startAt: string, home: string, away: string, roundLabel: string | null, score?: [number, number]) =>
  espnMatch({
    externalId: id,
    startAt,
    roundLabel,
    home: { externalId: home, name: home },
    away: { externalId: away, name: away },
    ...(score ? { homeScore: score[0], awayScore: score[1] } : {}),
  });

beforeEach(async () => {
  ({ db, eplId } = (await setupDb()) as { db: Db & { close(): Promise<void> }; eplId: number });
});
afterEach(() => db.close());

describe("리그 페이지 이동", () => {
  it("라운드가 없으면 한국 날짜 기준 7일씩, 앞뒤에 경기가 있을 때만 이동", async () => {
    await upsertMatches(db, eplId, "espn", [
      m("1", "2026-10-18T14:00:00Z", "359", "368", null, [2, 0]),
      m("2", "2026-10-25T14:00:00Z", "382", "359", null),
      m("3", "2026-11-01T14:00:00Z", "359", "382", null),
    ]);
    const now = new Date("2026-10-23T00:00:00Z"); // 한국 10월 23일 09시
    const p = await getLeaguePage(db, "epl", "ko", now);
    expect(p?.nav).toEqual({
      mode: "week",
      from: "2026-10-23",
      to: "2026-10-29",
      prev: "?from=2026-10-16",
      next: "?from=2026-10-30",
      isDefault: true,
    });
    expect(p?.week.map((x) => x.id).length).toBe(1);

    // 지난 주: 끝난 경기 결과가 보인다
    const past = await getLeaguePage(db, "epl", "ko", now, { from: "2026-10-16" });
    expect(past?.week).toHaveLength(1);
    expect(past?.week[0]).toMatchObject({ homeScore: 2, awayScore: 0 });
    expect(past?.nav).toMatchObject({ prev: null, next: "?from=2026-10-23", isDefault: false });

    // 경기가 없는 기간은 건너뛴다: 마지막 경기(11월 1일)가 끝에 오는 7일로
    const empty = await getLeaguePage(db, "epl", "ko", now, { from: "2026-11-20" });
    expect(empty?.week).toEqual([]);
    expect(empty?.nav).toMatchObject({ prev: "?from=2026-10-26", next: null });
  });

  it("축구는 라운드 단위: 기본은 아직 끝나지 않은 라운드, 마지막 라운드 뒤 토너먼트는 7일 보기로", async () => {
    await upsertMatches(db, eplId, "espn", [
      m("1", "2026-10-18T14:00:00Z", "359", "368", "@md:1", [2, 0]),
      m("2", "2026-10-25T14:00:00Z", "382", "359", "@md:2"),
      m("3", "2026-10-26T19:00:00Z", "368", "382", "@md:2"),
      m("4", "2026-11-01T14:00:00Z", "359", "382", "@md:3"),
      m("5", "2026-11-20T14:00:00Z", "382", "368", "@stage:final"),
    ]);
    const now = new Date("2026-10-23T00:00:00Z");
    const p = await getLeaguePage(db, "epl", "ko", now);
    expect(p?.nav).toEqual({ mode: "round", round: 2, prev: "?round=1", next: "?round=3", isDefault: true });
    expect(p?.week.map((x) => x.roundLabel)).toEqual(["@md:2", "@md:2"]);

    const r1 = await getLeaguePage(db, "epl", "ko", now, { round: 1 });
    expect(r1?.nav).toMatchObject({ round: 1, prev: null, next: "?round=2", isDefault: false });
    expect(r1?.week[0]).toMatchObject({ homeScore: 2, awayScore: 0 });

    // 마지막 라운드 다음은 그 뒤 첫 경기 날짜부터 7일
    const r3 = await getLeaguePage(db, "epl", "ko", now, { round: 3 });
    expect(r3?.nav).toMatchObject({ round: 3, next: "?from=2026-11-20" });

    // 라운드가 모두 끝났고 뒤에 경기가 있으면 기본은 7일 보기
    const later = await getLeaguePage(db, "epl", "ko", new Date("2026-11-15T00:00:00Z"));
    expect(later?.nav).toMatchObject({ mode: "week", from: "2026-11-15", isDefault: true });
    expect(later?.week.map((x) => x.roundLabel)).toEqual(["@stage:final"]);

    // ?from 을 주면 축구도 7일 보기, 없는 라운드는 기본 라운드
    expect((await getLeaguePage(db, "epl", "ko", now, { from: "2026-10-16" }))?.nav.mode).toBe("week");
    expect((await getLeaguePage(db, "epl", "ko", now, { round: 99 }))?.nav).toMatchObject({ round: 2, isDefault: true });
  });

  it("잘못된 이동 값은 무시한다", () => {
    expect(isLeagueQueryValid({ from: "2026-02-30" })).toBe(false);
    expect(isLeagueQueryValid({ from: "2026-1-1" })).toBe(false);
    expect(isLeagueQueryValid({ round: 0 })).toBe(false);
    expect(isLeagueQueryValid({ from: "2026-10-28", round: 9 })).toBe(true);
  });
});

describe("같은 리그 다른 경기 (날짜 패널)", () => {
  it("그 시간대 날짜의 대회 경기, F1 같은 이벤트형 종목은 뺀다", async () => {
    await seed(db, {
      sports: [{ slug: "motorsport", name_ko: "모터스포츠" }],
      competitions: [{ slug: "f1", sport: "motorsport", name_ko: "F1", type: "motorsport" }],
      teams: [],
    });
    await upsertMatches(db, eplId, "espn", [
      m("1", "2026-10-25T14:00:00Z", "382", "359", "@md:9"), // 한국 25일 23시
      m("2", "2026-10-25T16:00:00Z", "368", "382", "@md:9"), // 한국 26일 01시
      m("3", "2026-10-24T11:30:00Z", "359", "368", "@md:9", [1, 1]), // 한국 24일 20시 30분
    ]);
    await db.query(
      `insert into match (competition_id, season, title, start_at) select id, '2026', '@f1:Mexico City Grand Prix:race', '2026-10-25T13:00:00Z' from competition where slug = 'f1'`,
    );
    const seoul = await getCompetitionsDay(db, ["epl", "f1"], "2026-10-25", "Asia/Seoul", "ko");
    expect(seoul.map((x) => x.startAt)).toEqual(["2026-10-25T14:00:00.000Z"]);
    const london = await getCompetitionsDay(db, ["epl"], "2026-10-25", "Europe/London", "ko");
    expect(london.map((x) => x.startAt)).toEqual(["2026-10-25T14:00:00.000Z", "2026-10-25T16:00:00.000Z"]);
    const sat = await getCompetitionsDay(db, ["epl"], "2026-10-24", "Asia/Seoul", "en");
    expect(sat[0]).toMatchObject({ homeScore: 1, awayScore: 1, homeLabel: "Arsenal" });
    expect(await getCompetitionsDay(db, [], "2026-10-25", "Asia/Seoul", "ko")).toEqual([]);
  });
});
