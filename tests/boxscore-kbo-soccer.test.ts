import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseEspn, parseKbo, type EspnSummary } from "@/lib/boxscore";
import { getBoxScore } from "@/lib/boxscoreStore";
import type { Db } from "@/lib/db";
import { setupDb } from "./helpers";

// KBO 표는 JSON 문자열 안의 JSON 문자열
const table = (rows: string[][], extra: { headers?: string[][]; tfoot?: string[][] } = {}) =>
  JSON.stringify({
    headers: (extra.headers ?? []).map((r) => ({ row: r.map((Text) => ({ Text })) })),
    rows: rows.map((r) => ({ row: r.map((Text) => ({ Text })) })),
    tfoot: (extra.tfoot ?? []).map((r) => ({ row: r.map((Text) => ({ Text })) })),
  });
const PITCH_HEAD = [
  "선수명",
  "등판",
  "결과",
  "승",
  "패",
  "세",
  "이닝",
  "타자",
  "투구수",
  "타수",
  "피안타",
  "홈런",
  "4사구",
  "삼진",
  "실점",
  "자책",
  "평균자책점",
];
const hitter = (name: string) => ({
  table1: table([
    ["1", "중", name],
    ["1", "타", "대타"],
  ]),
  table2: table(
    [
      ["좌비", "&nbsp;"],
      ["&nbsp;", "삼진"],
    ],
    { headers: [["1", "2"]] },
  ),
  table3: table(
    [
      ["1", "0", "0", "0", "0.250"],
      ["1", "0", "0", "0", "0.100"],
    ],
    { tfoot: [["2", "0", "0", "0", "0.000"]] },
  ),
});
const pitcher = (name: string, result: string) => ({
  table: table([[name, "선발", result, "0", "0", "0", "9", "30", "100", "28", "5", "1", "2", "7", "1", "1", "1.00"]], {
    headers: [PITCH_HEAD],
    tfoot: [["TOTAL", "9", "30", "100", "28", "5", "1", "2", "7", "1", "1", "1.00"]],
  }),
});

describe("KBO 기록지", () => {
  it("이닝 점수(15회 칸 중 한 이닝까지, 9회말 X), R·H·E, 타격·타석 결과·투구, 주요 기록", () => {
    const box = parseKbo(
      {
        tableEtc: table([
          ["결승타", "구자욱(3회 2사 2루서 우중간 안타)"],
          ["홈런", "디아즈1호(3회2점 올러)"],
        ]),
        arrHitter: [hitter("박재현"), hitter("김지찬")],
        arrPitcher: [pitcher("올러", "패"), pitcher("후라도", "승")],
      },
      {
        CROWD_CN: "23,550",
        USE_TM: "3:25",
        table2: table([
          ["0", "0", "1", "0", "0", "0", "1", "1", "0", "-", "-"],
          ["0", "0", "4", "0", "1", "2", "1", "0", "-", "-", "-"],
        ]),
        table3: table([
          ["3", "6", "0", "2"],
          ["8", "9", "1", "6"],
        ]),
      },
    );
    expect(box.line).toEqual({
      labels: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "R", "H", "E"],
      away: ["0", "0", "1", "0", "0", "0", "1", "1", "0", "3", "6", "0"],
      home: ["0", "0", "4", "0", "1", "2", "1", "0", "X", "8", "9", "1"],
    });
    expect(box.info).toEqual({ crowd: "23,550", duration: "3:25" });
    expect(box.notes?.[0]).toEqual({ label: "결승타", text: "구자욱(3회 2사 2루서 우중간 안타)" });
    expect(box.home.map((g) => g.key)).toEqual(["batting", "plays", "pitching"]);
    expect(box.home[0].rows.map((r) => [r.name, r.sub])).toEqual([
      ["김지찬", false],
      ["대타", true],
    ]);
    expect(box.home[1].rows[0].stats).toEqual(["좌비", ""]);
    expect(box.home[2].rows[0]).toEqual({ name: "후라도", note: "승", stats: ["9", "5", "1", "1", "2", "7", "1", "100", "1.00"] });
    expect(box.home[2].totals).toEqual(["9", "5", "1", "1", "2", "7", "1", "100", "1.00"]);
    expect(box.away[0].rows[0].name).toBe("박재현");
  });
});

const soccer: EspnSummary = {
  header: {
    competitions: [
      {
        competitors: [
          { homeAway: "home", id: "359", score: "2" },
          { homeAway: "away", id: "368", score: "1" },
        ],
      },
    ],
  },
  boxscore: {
    teams: [
      {
        team: { id: "359" },
        statistics: [
          { name: "possessionPct", displayValue: "61.2" },
          { name: "totalShots", displayValue: "15" },
        ],
      },
      {
        team: { id: "368" },
        statistics: [
          { name: "possessionPct", displayValue: "38.8" },
          { name: "totalShots", displayValue: "6" },
        ],
      },
    ],
  },
  rosters: [
    {
      homeAway: "home",
      roster: [
        {
          starter: true,
          athlete: { displayName: "Bukayo Saka" },
          position: { abbreviation: "RW" },
          stats: [{ name: "totalGoals", displayValue: "2" }],
        },
        { starter: false, subbedIn: true, athlete: { displayName: "Sub In" } },
        { starter: false, subbedIn: false, athlete: { displayName: "Unused" } },
      ],
    },
  ],
  keyEvents: [
    {
      type: { type: "goal" },
      scoringPlay: true,
      clock: { displayValue: "12'" },
      team: { id: "359" },
      participants: [{ athlete: { displayName: "Bukayo Saka" } }, { athlete: { displayName: "Ødegaard" } }],
    },
    {
      type: { type: "yellow-card" },
      clock: { displayValue: "40'" },
      team: { id: "368" },
      participants: [{ athlete: { displayName: "Tarkowski" } }],
    },
    {
      type: { type: "penalty---scored" },
      scoringPlay: true,
      clock: { displayValue: "90'+2'" },
      team: { id: "359" },
      participants: [{ athlete: { displayName: "Bukayo Saka" } }],
    },
    {
      type: { type: "substitution" },
      clock: { displayValue: "60'" },
      team: { id: "359" },
      participants: [{ athlete: { displayName: "Sub In" } }],
    },
  ],
};

describe("축구 기록지", () => {
  it("팀 기록(점유율 %), 출전 선수(안 뛴 교체 제외), 골·카드", () => {
    const box = parseEspn(soccer, "soccer/all");
    expect(box.line).toBeNull();
    expect(box.stats).toEqual([
      { key: "possessionPct", home: "61.2%", away: "38.8%" },
      { key: "shots", home: "15", away: "6" },
    ]);
    expect(box.home[0].rows.map((r) => [r.name, r.sub, r.stats[0]])).toEqual([
      ["Bukayo Saka", false, "2"],
      ["Sub In", true, ""],
    ]);
    expect(box.events).toEqual([
      { min: "12'", side: "home", type: "goal", player: "Bukayo Saka", assist: "Ødegaard" },
      { min: "40'", side: "away", type: "yellow", player: "Tarkowski" },
      { min: "90'+2'", side: "home", type: "pen", player: "Bukayo Saka" },
    ]);
  });

  describe("football-data 경기는 ESPN 그날 일정에서 찾는다", () => {
    let db: Db & { close(): Promise<void> };
    let matchId: string;
    beforeEach(async () => {
      ({ db } = (await setupDb()) as { db: Db & { close(): Promise<void> } });
      [{ id: matchId }] = await db.query<{ id: string }>(
        `insert into match (competition_id, season, home_team_id, away_team_id, start_at, home_score, away_score)
         select c.id, '2026', h.id, a.id, '2026-10-25T14:00:00Z', 2, 1
         from competition c, team h, team a where c.slug = 'epl' and h.slug = 'arsenal' and a.slug = 'everton'
         returning id`,
      );
      await db.query("insert into match_source_ref (match_id, source, external_id) values ($1, 'football-data', '537001')", [matchId]);
    });
    afterEach(() => db.close());

    it("두 팀의 ESPN ID로 경기를 찾고, 찾은 ID는 기록지에 남겨 다시 찾지 않는다", async () => {
      const calls: string[] = [];
      const fetcher = async (url: string) => {
        calls.push(url);
        const body = url.includes("/scoreboard")
          ? {
              events: [
                {
                  id: "999",
                  competitions: [
                    {
                      competitors: [
                        { homeAway: "home", team: { id: "382", displayName: "Manchester City" } },
                        { homeAway: "away", team: { id: "359", displayName: "Arsenal" } },
                      ],
                    },
                  ],
                },
                {
                  id: "401",
                  competitions: [
                    {
                      competitors: [
                        { homeAway: "home", team: { id: "359", displayName: "Arsenal" } },
                        { homeAway: "away", team: { id: "368", displayName: "Everton" } },
                      ],
                    },
                  ],
                },
              ],
            }
          : soccer;
        return new Response(JSON.stringify(body), { status: 200 });
      };
      const box = await getBoxScore(db, matchId, { fetcher, now: new Date("2026-10-25T17:00:00Z") });
      expect(box?.ref).toBe("401");
      expect(calls).toEqual([
        "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20261025",
        "https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=401",
      ]);
      // 30분 뒤 다시 받을 때는 일정 조회 없이 바로
      await getBoxScore(db, matchId, { fetcher, now: new Date("2026-10-25T18:00:00Z") });
      expect(calls.at(-1)).toBe("https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=401");
      expect(calls).toHaveLength(3);
    });
  });
});
