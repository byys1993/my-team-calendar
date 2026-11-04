import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertMatches } from "@/collector/upsert";
import type { Db } from "@/lib/db";
import { MESSAGES } from "@/i18n";
import { getLeaguePage, getTeamPage, nextMatchLabel, sitemapEntries } from "@/lib/pages";
import type { ScheduleMatch } from "@/lib/schedule";
import { espnMatch, setupDb } from "./helpers";

let db: Db & { close(): Promise<void> };
let eplId: number;
beforeEach(async () => {
  ({ db, eplId } = (await setupDb()) as { db: Db & { close(): Promise<void> }; eplId: number });
  const m = (id: string, startAt: string, home: string, away: string, score?: [number, number]) =>
    espnMatch({
      externalId: id,
      startAt,
      home: { externalId: home, name: home },
      away: { externalId: away, name: away },
      ...(score ? { homeScore: score[0], awayScore: score[1] } : {}),
    });
  await upsertMatches(db, eplId, "espn", [
    m("1", "2026-10-18T14:00:00Z", "359", "368", [2, 0]), // 아스널 홈 승 (지난 경기)
    m("2", "2026-10-25T14:00:00Z", "382", "359"), // 맨시티 vs 아스널 (다가오는 경기)
    m("3", "2026-11-01T14:00:00Z", "359", "382"),
  ]);
  await db.query(
    `insert into standing (competition_id, kind, season, groups, source)
     values ($1, 'teams', '2026', $2::text::jsonb, 'espn')`,
    [eplId, JSON.stringify([{ name: null, rows: [{ rank: 1, team: "man-city", name: "Man City", stats: {} }, { rank: 2, team: "arsenal", name: "Arsenal", stats: {} }] }])],
  );
});
afterEach(() => db.close());

const now = new Date("2026-10-23T00:00:00Z");

describe("검색 설명의 다음 경기", () => {
  const ko = MESSAGES.ko;
  const game = (over: Partial<ScheduleMatch>) =>
    ({
      title: null,
      home: "man-city",
      away: "arsenal",
      homeLabel: "맨시티",
      awayLabel: "아스널",
      startAt: "2026-10-25T14:00:00Z",
      dateOnly: null,
      status: "scheduled",
      ...over,
    }) as ScheduleMatch;

  it("팀 페이지는 그 팀을 앞에, 시각은 한국 시간으로", () => {
    expect(nextMatchLabel([game({})], "arsenal", ko, "ko", now)).toBe("10월 25일 (일) 23:00 아스널 vs 맨시티");
    expect(nextMatchLabel([game({})], null, ko, "ko", now)).toBe("10월 25일 (일) 23:00 맨시티 vs 아스널");
  });

  it("시각이 미정이면 날짜만", () => {
    const list = [game({ startAt: null, dateOnly: "2026-10-25", status: "time_tbd" })];
    expect(nextMatchLabel(list, null, ko, "ko", now)).toBe("10월 25일 (일) 맨시티 vs 아스널");
  });

  it("F1 같은 이벤트는 세션 이름", () => {
    const list = [game({ title: "@f1:Las Vegas Grand Prix:race", home: null, away: null })];
    expect(nextMatchLabel(list, "f1", ko, "ko", now)).toMatch(/^10월 25일 \(일\) 23:00 .+결승$/);
  });

  it("이미 시작한 경기, 열릴지 모르는 경기는 건너뛴다", () => {
    const later = game({ startAt: "2026-11-01T14:00:00Z" });
    expect(nextMatchLabel([game({ startAt: "2026-10-22T23:00:00Z" }), later], null, ko, "ko", now)).toContain("11월 1일");
    expect(nextMatchLabel([game({ status: "conditional" }), later], null, ko, "ko", now)).toContain("11월 1일");
    expect(nextMatchLabel([game({ status: "postponed" })], null, ko, "ko", now)).toBeNull();
    expect(nextMatchLabel([], null, ko, "ko", now)).toBeNull();
  });
});

describe("팀·리그 페이지", () => {
  it("팀 페이지: 다가오는 경기·최근 결과·순위·같은 리그 팀", async () => {
    const p = await getTeamPage(db, "arsenal", "ko", now);
    expect(p?.team.name).toBe("아스널");
    expect(p?.competition?.slug).toBe("epl");
    expect(p?.upcoming.map((x) => x.startAt)).toEqual(["2026-10-25T14:00:00.000Z", "2026-11-01T14:00:00.000Z"]);
    expect(p?.recent[0]).toMatchObject({ homeScore: 2, awayScore: 0 });
    expect(p?.standing).toMatchObject({ rank: 2, size: 2 });
    expect(p?.leagueTeams.map((t) => t.slug).sort()).toEqual(["everton", "man-city"]);
    expect(await getTeamPage(db, "no-such-team", "ko", now)).toBeNull();
  });

  it("리그 페이지: 이번 주 경기와 순위표", async () => {
    const p = await getLeaguePage(db, "epl", "ko", now);
    expect(p?.week.map((x) => x.startAt)).toEqual(["2026-10-25T14:00:00.000Z"]);
    expect(p?.tables[0].groups[0].rows[0].team).toBe("man-city");
    expect(p?.teamName.arsenal).toBe("아스널");
    expect(await getLeaguePage(db, "nope", "ko", now)).toBeNull();
  });

  it("사이트맵에 모든 팀·리그", async () => {
    const s = await sitemapEntries(db);
    expect(s.leagues).toEqual(["epl"]);
    expect(s.teams.sort()).toEqual(["arsenal", "everton", "man-city"]);
  });
});
