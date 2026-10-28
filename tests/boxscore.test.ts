import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseEspn, parseMlb, parseNhl, type EspnSummary, type MlbBox, type MlbLinescore, type NhlBox } from "@/lib/boxscore";
import { getBoxScore } from "@/lib/boxscoreStore";
import { cleanupExpired } from "@/lib/cleanup";
import type { Db } from "@/lib/db";
import { createMemoryDb } from "@/lib/db/pglite";
import { migrate } from "@/lib/db/migrate";
import { seed } from "@/lib/db/seed";

// 보스턴(홈) 125:124 브루클린, 연장 1번
const nba: EspnSummary = {
  header: {
    competitions: [
      {
        competitors: [
          { homeAway: "home", id: "2", score: "125", linescores: ["26", "30", "30", "31", "8"].map((displayValue) => ({ displayValue })) },
          { homeAway: "away", id: "17", score: "124", linescores: ["31", "30", "21", "35", "7"].map((displayValue) => ({ displayValue })) },
        ],
      },
    ],
  },
  boxscore: {
    teams: [
      {
        homeAway: "away",
        team: { id: "17" },
        statistics: [
          { name: "totalRebounds", displayValue: "48" },
          { name: "assists", displayValue: "26" },
        ],
      },
      {
        homeAway: "home",
        team: { id: "2" },
        statistics: [
          { name: "totalRebounds", displayValue: "47" },
          { name: "assists", displayValue: "32" },
        ],
      },
    ],
    players: [
      {
        team: { id: "2" },
        statistics: [
          {
            labels: ["MIN", "PTS"],
            athletes: [
              { athlete: { displayName: "Jayson Tatum", position: { abbreviation: "F" } }, starter: true, stats: ["44", "35"] },
              { athlete: { displayName: "Bench Guy" }, starter: false, stats: ["10", "4"] },
              { athlete: { displayName: "Did Not Play" }, didNotPlay: true, stats: [] },
            ],
            totals: ["", "125"],
          },
        ],
      },
      {
        team: { id: "17" },
        statistics: [{ labels: ["MIN", "PTS"], athletes: [{ athlete: { displayName: "Away Star" }, starter: true, stats: ["40", "30"] }] }],
      },
    ],
  },
};

describe("기록지 변환", () => {
  it("ESPN 농구: 쿼터·연장 점수, 팀 기록, 선수(출전 안 한 선수 제외)", () => {
    const box = parseEspn(nba, "basketball/nba");
    expect(box.line).toEqual({
      labels: ["1", "2", "3", "4", "OT", "T"],
      home: ["26", "30", "30", "31", "8", "125"],
      away: ["31", "30", "21", "35", "7", "124"],
    });
    expect(box.stats).toEqual([
      { key: "REB", home: "47", away: "48" },
      { key: "AST", home: "32", away: "26" },
    ]);
    expect(box.home[0].rows.map((r) => [r.name, r.sub])).toEqual([
      ["Jayson Tatum", false],
      ["Bench Guy", true],
    ]);
    expect(box.home[0].totals).toEqual(["", "125"]);
    expect(box.away[0].rows[0].name).toBe("Away Star");
  });

  it("MLB: 이닝 점수(9회말 안 한 홈팀 X)와 R·H·E, 타격·투구", () => {
    const player = (name: string, extra: object) =>
      ({ person: { fullName: name }, ...extra }) as MlbBox["teams"]["home"]["players"][string];
    const team = (batter: string, pitcher: string, note?: string) => ({
      batters: [1, 2],
      pitchers: [2],
      players: {
        ID1: player(batter, {
          position: { abbreviation: "SS" },
          battingOrder: "100",
          stats: { batting: { atBats: 4, runs: 1, hits: 2, rbi: 1, baseOnBalls: 0, strikeOuts: 1 } },
          seasonStats: { batting: { avg: ".301" } },
        }),
        ID2: player(pitcher, {
          stats: {
            batting: {},
            pitching: { inningsPitched: "9.0", hits: 3, runs: 1, earnedRuns: 1, baseOnBalls: 2, strikeOuts: 9, homeRuns: 0, note: note },
          },
          seasonStats: { pitching: { era: "2.10" } },
        }),
      },
      teamStats: { batting: { atBats: 4, runs: 1, hits: 2, rbi: 1, baseOnBalls: 0, strikeOuts: 1 }, pitching: { inningsPitched: "9.0" } },
    });
    const box: MlbBox = { teams: { home: team("Home SS", "Home P", "(W, 1-0)"), away: team("Away SS", "Away P") } };
    const ls: MlbLinescore = {
      innings: [
        { num: 1, home: { runs: 2 }, away: { runs: 0 } },
        { num: 9, home: {}, away: { runs: 1 } },
      ],
      teams: { home: { runs: 2, hits: 5, errors: 0 }, away: { runs: 1, hits: 3, errors: 1 } },
    };
    const out = parseMlb(box, ls);
    expect(out.line).toEqual({ labels: ["1", "9", "R", "H", "E"], home: ["2", "X", "2", "5", "0"], away: ["0", "1", "1", "3", "1"] });
    expect(out.home.map((g) => g.key)).toEqual(["batting", "pitching"]);
    expect(out.home[0].rows).toEqual([{ name: "Home SS", pos: "SS", sub: false, stats: ["4", "1", "2", "1", "0", "1", ".301"] }]);
    expect(out.home[1].rows[0]).toMatchObject({ name: "Home P", note: "W, 1-0", stats: ["9.0", "3", "1", "1", "2", "9", "0", "2.10"] });
  });

  it("NHL: 피리어드·연장·슛아웃, 팀 기록, 출전 안 한 골리 제외", () => {
    const skater = {
      name: { default: "J. Miller" },
      position: "C",
      goals: 1,
      assists: 0,
      points: 1,
      plusMinus: 0,
      sog: 6,
      pim: 2,
      toi: "20:32",
    };
    const team = {
      forwards: [skater],
      defense: [],
      goalies: [
        { name: { default: "D. Garand" }, shotsAgainst: 17, saves: 15, savePctg: 0.882353, goalsAgainst: 2, toi: "38:05", decision: "L" },
        { name: { default: "Backup" }, toi: "00:00" },
      ],
    };
    const box: NhlBox = { playerByGameStats: { homeTeam: team, awayTeam: team } };
    const out = parseNhl(box, {
      linescore: {
        byPeriod: [1, 2, 3]
          .map((n) => ({ periodDescriptor: { number: n, periodType: "REG" }, home: 1, away: 1 }))
          .concat([
            { periodDescriptor: { number: 4, periodType: "OT" }, home: 0, away: 0 },
            { periodDescriptor: { number: 5, periodType: "SO" }, home: 1, away: 0 },
          ]),
        totals: { home: 4, away: 3 },
      },
      teamGameStats: [
        { category: "sog", homeValue: 26, awayValue: 30 },
        { category: "faceoffWinningPctg", homeValue: 0.5, awayValue: 0.5 },
      ],
    });
    expect(out.line?.labels).toEqual(["1", "2", "3", "OT", "SO", "T"]);
    expect(out.stats).toEqual([{ key: "shots", home: "26", away: "30" }]);
    expect(out.home.map((g) => g.key)).toEqual(["forwards", "goalies"]);
    expect(out.home[1].rows).toEqual([{ name: "D. Garand", note: "L", stats: ["17", "15", ".882", "2", "38:05"] }]);
  });
});

describe("기록지 저장", () => {
  let db: Db & { close(): Promise<void> };
  let matchId: string;
  beforeEach(async () => {
    db = await createMemoryDb();
    await migrate(db);
    await seed(db, {
      sports: [{ slug: "basketball", name_ko: "농구" }],
      competitions: [
        { slug: "nba", sport: "basketball", name_ko: "NBA", type: "league", sources: [{ source: "espn", external_id: "basketball/nba" }] },
      ],
      teams: [
        { slug: "nba-bos", sport: "basketball", competition: "nba", name_ko: "보스턴", name_en: "Boston", refs: { espn: "2" } },
        { slug: "nba-bkn", sport: "basketball", competition: "nba", name_ko: "브루클린", name_en: "Brooklyn", refs: { espn: "17" } },
      ],
    });
    [{ id: matchId }] = await db.query<{ id: string }>(
      `insert into match (competition_id, season, home_team_id, away_team_id, start_at, home_score, away_score)
       select c.id, '2027', h.id, a.id, '2026-10-27T23:30:00Z', 125, 124
       from competition c, team h, team a where c.slug = 'nba' and h.slug = 'nba-bos' and a.slug = 'nba-bkn'
       returning id`,
    );
    await db.query("insert into match_source_ref (match_id, source, external_id) values ($1, 'espn', '401909877')", [matchId]);
  });
  afterEach(() => db.close());

  const fetcher = () => {
    const calls: string[] = [];
    const f = async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify(nba), { status: 200 });
    };
    return Object.assign(f, { calls });
  };

  it("처음 열 때만 받아 저장하고, 경기 직후 30분이 지나면 다시 받는다", async () => {
    const f = fetcher();
    const first = await getBoxScore(db, matchId, { fetcher: f, now: new Date("2026-10-28T02:00:00Z") });
    expect(first?.line?.labels.at(-1)).toBe("T");
    expect(f.calls).toEqual(["https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=401909877"]);

    await getBoxScore(db, matchId, { fetcher: f, now: new Date("2026-10-28T02:10:00Z") });
    expect(f.calls).toHaveLength(1); // 저장된 것

    await getBoxScore(db, matchId, { fetcher: f, now: new Date("2026-10-28T03:00:00Z") });
    expect(f.calls).toHaveLength(2); // 경기 직후 기록이라 다시 받음

    await getBoxScore(db, matchId, { fetcher: f, now: new Date("2026-10-30T00:00:00Z") });
    await getBoxScore(db, matchId, { fetcher: f, now: new Date("2026-11-30T00:00:00Z") });
    expect(f.calls).toHaveLength(3); // 다음날 받은 뒤로는 고정
  });

  it("끝나지 않은 경기는 받지 않고, 3년 지난 기록지는 정리된다", async () => {
    const f = fetcher();
    await getBoxScore(db, matchId, { fetcher: f, now: new Date("2026-10-29T00:00:00Z") });
    expect((await cleanupExpired(db, new Date("2029-01-01T00:00:00Z"))).boxscores).toBe(0);
    expect((await cleanupExpired(db, new Date("2029-11-01T00:00:00Z"))).boxscores).toBe(1);

    await db.query("update match set home_score = null, away_score = null where id = $1", [matchId]);
    expect(await getBoxScore(db, matchId, { fetcher: f })).toBeNull();
  });
});
