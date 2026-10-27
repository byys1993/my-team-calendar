import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertMatches } from "@/collector/upsert";
import type { Db } from "@/lib/db";
import { getLeaguePage, getTeamPage, sitemapEntries } from "@/lib/pages";
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
