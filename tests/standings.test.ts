import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addResults, parseJolpica } from "@/collector/sources/f1";
import {
  parseEspnStandings,
  parseF1Standings,
  parseKblStandings,
  parseKboStandings,
  parseKleagueStandings,
  parseLolStandings,
  syncStandings,
} from "@/collector/standings";
import type { Db } from "@/lib/db";
import { setupDb } from "./helpers";

describe("F1 결과", () => {
  it("전체 순위를 세션 경기에 붙이고, 포디움은 결승 1~3위·예선 폴 포지션 (두 쪽에 나뉘어 와도 합친다)", () => {
    const races = parseJolpica([
      {
        season: "2026",
        round: "17",
        raceName: "Singapore Grand Prix",
        date: "2026-10-04",
        time: "12:00:00Z",
        Circuit: { circuitName: "Marina Bay" },
        Qualifying: { date: "2026-10-03", time: "13:00:00Z" },
      },
    ]);
    const res = (pos: number, id: string, fam: string) => ({
      position: String(pos),
      Driver: { driverId: id, code: id.slice(0, 3).toUpperCase(), familyName: fam },
      Constructor: { name: "Team" },
    });
    const out = addResults(races, [
      { kind: "race", races: [{ season: "2026", round: "17", Results: [res(1, "max_verstappen", "Verstappen"), res(2, "norris", "Norris")] }] },
      { kind: "race", races: [{ season: "2026", round: "17", Results: [res(3, "leclerc", "Leclerc"), res(4, "hamilton", "Hamilton")] }] },
      { kind: "quali", races: [{ season: "2026", round: "17", QualifyingResults: [res(1, "norris", "Norris"), res(2, "hamilton", "Hamilton")] }] },
    ]);
    const race = out.find((m) => m.externalId === "2026-17-race")!;
    const quali = out.find((m) => m.externalId === "2026-17-quali")!;
    expect(race.podium?.map((p) => [p.pos, p.driverId])).toEqual([
      [1, "max_verstappen"],
      [2, "norris"],
      [3, "leclerc"],
    ]);
    expect(race.results?.map((p) => p.driverId)).toEqual(["max_verstappen", "norris", "leclerc", "hamilton"]);
    expect(quali.podium?.map((p) => p.driverId)).toEqual(["norris"]);
    expect(quali.results).toHaveLength(2);
  });
});

describe("순위표 변환", () => {
  it("ESPN 미국 리그: 컨퍼런스별, 시드 순, 팀 ID 에 리그를 붙인다", () => {
    const entry = (id: string, name: string, seed: number, w: number, l: number) => ({
      team: { id, displayName: name },
      stats: [
        { name: "playoffSeed", value: seed },
        { name: "wins", value: w },
        { name: "losses", value: l },
        { name: "winPercent", value: w / (w + l) },
        { name: "gamesBehind", value: 0 },
      ],
    });
    const t = parseEspnStandings(
      { children: [{ name: "Eastern Conference", standings: { entries: [entry("2", "Boston Celtics", 2, 5, 1), entry("1", "Atlanta Hawks", 1, 6, 0)] } }] },
      "basketball/nba",
    );
    expect(t.groups[0].name).toBe("Eastern Conference");
    expect(t.groups[0].rows.map((r) => [r.rank, r.ref?.externalId])).toEqual([
      [1, "nba:1"],
      [2, "nba:2"],
    ]);
  });

  it("KBO 순위 화면(HTML 표)", () => {
    const html = `<table summary="순위, 팀명,승,패,무,승률,승차,최근10경기,연속,홈,방문" class="tData"><thead></thead><tbody>
      <tr><td>1</td><td>KT</td><td>144</td><td>90</td><td>49</td><td>5</td><td>0.647</td><td>0</td><td>9승1무0패</td></tr>
      <tr><td>2</td><td>LG</td><td>144</td><td>85</td><td>56</td><td>3</td><td>0.603</td><td>6.0</td><td>5승5패</td></tr>
    </tbody></table>`;
    const t = parseKboStandings(html, "2026");
    expect(t.groups[0].rows[1]).toMatchObject({
      rank: 2,
      ref: { source: "kbo", externalId: "LG" },
      stats: { gp: 144, w: 85, l: 56, d: 3, pct: 0.603, gb: 6 },
    });
    expect(() => parseKboStandings("<html></html>", "2026")).toThrow();
  });

  it("KBL·K리그·LCK·F1", () => {
    expect(parseKblStandings([{ rank: 1, tcode: "35", tname: "서울 삼성", win: 6, loss: 2, winDiff: 0 }]).groups[0].rows[0]).toMatchObject({
      ref: { source: "kbl", externalId: "35" },
      stats: { gp: 8, w: 6, l: 2, pct: 0.75 },
    });
    const k = parseKleagueStandings(
      [{ rank: 1, teamId: "K09", teamName: "서울", gameCount: 32, winCnt: 20, tieCnt: 6, lossCnt: 6, gainGoal: 60, lossGoal: 28, gapCnt: 32, gainPoint: 66 }],
      "2026",
    );
    expect(k.groups[0].rows[0]).toMatchObject({ ref: { externalId: "K09" }, stats: { pts: 66, gd: 32 } });
    const lol = parseLolStandings(
      {
        data: {
          standings: [
            {
              stages: [
                {
                  name: "그룹",
                  sections: [
                    { name: "레전드 그룹", rankings: [{ ordinal: 1, teams: [{ code: "GEN", name: "Gen.G", record: { wins: 5, losses: 3 } }] }] },
                    { name: "플레이-인", rankings: [] },
                  ],
                },
              ],
            },
          ],
        },
      },
      "2026",
    );
    expect(lol.groups).toHaveLength(1);
    expect(lol.groups[0].rows[0]).toMatchObject({ ref: { externalId: "GEN" }, stats: { w: 5, l: 3 } });
    const f1 = parseF1Standings(
      {
        season: "2026",
        DriverStandings: [
          { position: "1", positionText: "1", points: "340", wins: "8", Driver: { driverId: "antonelli", familyName: "Antonelli" }, Constructors: [{ name: "Mercedes" }] },
        ],
      },
      { season: "2026", ConstructorStandings: [{ position: "1", positionText: "1", points: "578", wins: "11", Constructor: { name: "Mercedes" } }] },
    );
    expect(f1.map((t) => t.kind)).toEqual(["drivers", "constructors"]);
    expect(f1[0].groups[0].rows[0]).toMatchObject({ driverId: "antonelli", sub: "Mercedes", stats: { pts: 340, wins: 8 } });
  });
});

describe("순위표 저장", () => {
  let db: Db & { close(): Promise<void> };
  beforeEach(async () => {
    ({ db } = (await setupDb()) as { db: Db & { close(): Promise<void> } });
  });
  afterEach(() => db.close());

  it("팀을 우리 팀에 연결해 저장하고, 3시간 안에는 다시 받지 않는다", async () => {
    let calls = 0;
    const fetcher = (async (url: string) => {
      calls++;
      if (url.includes("/scorers")) {
        return new Response(JSON.stringify({ scorers: [{ player: { name: "Saka" }, team: { id: 999, name: "Arsenal FC" }, goals: 7 }] }));
      }
      return new Response(
        JSON.stringify({
          season: { startDate: "2026-08-15" },
          standings: [
            {
              type: "TOTAL",
              group: null,
              table: [
                { position: 1, team: { id: 999, name: "Arsenal FC", shortName: "Arsenal" }, playedGames: 8, won: 6, draw: 1, lost: 1, points: 19, goalsFor: 15, goalsAgainst: 5, goalDifference: 10 },
                { position: 2, team: { id: 998, name: "Mystery FC" }, playedGames: 8, won: 5, draw: 1, lost: 2, points: 16, goalsFor: 10, goalsAgainst: 8, goalDifference: 2 },
              ],
            },
          ],
        }),
      );
    }) as typeof fetch;
    const now = new Date("2026-10-23T00:00:00Z");
    const r = await syncStandings(db, { fetcher, footballDataKey: "k", now, only: ["epl"], footballDataGapMs: 0 });
    // 순위표 + 개인 순위(득점)
    expect(r).toEqual([{ competition: "epl", ok: true, tables: 2 }]);
    const [row] = await db.query<{ groups: { rows: { team: string | null; name: string }[] }[]; season: string }>(
      "select groups, season from standing where kind = 'teams'",
    );
    const [lead] = await db.query<{ groups: { name: string; rows: { team: string | null; name: string }[] }[] }>(
      "select groups from standing where kind = 'leaders'",
    );
    expect(lead.groups[0]).toMatchObject({ name: "goals", rows: [{ name: "Saka", team: "arsenal" }] });
    // ID 연결이 없어도 이름(별칭)으로 연결, 모르는 팀은 null
    expect(row.season).toBe("2026");
    expect(row.groups[0].rows.map((x) => x.team)).toEqual(["arsenal", null]);

    await syncStandings(db, { fetcher, footballDataKey: "k", now: new Date("2026-10-23T02:00:00Z"), only: ["epl"], footballDataGapMs: 0 });
    expect(calls).toBe(2);
    await syncStandings(db, { fetcher, footballDataKey: "k", now: new Date("2026-10-23T03:30:00Z"), only: ["epl"], footballDataGapMs: 0 });
    expect(calls).toBe(4);
  });
});

describe("시즌 전환", () => {
  let db: Db & { close(): Promise<void> };
  beforeEach(async () => {
    ({ db } = (await setupDb()) as { db: Db & { close(): Promise<void> } });
  });
  afterEach(() => db.close());

  const table = (rows: { id: number; name: string }[]) =>
    new Response(
      JSON.stringify({
        season: { startDate: "2027-08-15" },
        standings: [
          {
            type: "TOTAL",
            group: null,
            table: rows.map((r, i) => ({
              position: i + 1,
              team: { id: r.id, name: r.name },
              playedGames: 0,
              won: 0,
              draw: 0,
              lost: 0,
              points: 0,
              goalsFor: 0,
              goalsAgainst: 0,
              goalDifference: 0,
            })),
          },
        ],
      }),
    );

  it("다른 리그 소속(시드)이던 팀이 이 리그 순위표에 있으면 지금 리그로 옮겨 보여 준다", async () => {
    // 에버턴이 시드상 2부(champ) 소속이었다가 1부(epl)로 승격한 상황
    await db.query(
      "insert into competition (sport_id, slug, name_ko, type) select sport_id, 'champ', '챔피언십', 'league' from competition where slug = 'epl'",
    );
    await db.query("update team set primary_competition_id = (select id from competition where slug = 'champ') where slug = 'everton'");
    const { getCatalog } = await import("@/lib/schedule");
    expect((await getCatalog(db, "ko")).teams.find((t) => t.slug === "everton")?.competition).toBe("champ");

    const fetcher = (async (url: string) =>
      url.includes("/scorers") ? new Response(JSON.stringify({ scorers: [] })) : table([{ id: 1, name: "Arsenal FC" }, { id: 2, name: "Everton FC" }])) as typeof fetch;
    await syncStandings(db, { fetcher, footballDataKey: "k", only: ["epl"], footballDataGapMs: 0 });
    expect((await getCatalog(db, "ko")).teams.find((t) => t.slug === "everton")?.competition).toBe("epl");
  });

  it("출처가 빈 순위표를 주면(새 시즌 시작 전) 지난 표를 지우지 않는다", async () => {
    const full = (async (url: string) =>
      url.includes("/scorers") ? new Response(JSON.stringify({ scorers: [] })) : table([{ id: 1, name: "Arsenal FC" }])) as typeof fetch;
    const empty = (async (url: string) => (url.includes("/scorers") ? new Response(JSON.stringify({ scorers: [] })) : table([]))) as typeof fetch;
    await syncStandings(db, { fetcher: full, footballDataKey: "k", only: ["epl"], footballDataGapMs: 0 });
    await syncStandings(db, { fetcher: empty, footballDataKey: "k", only: ["epl"], footballDataGapMs: 0, force: true });
    const [row] = await db.query<{ groups: { rows: unknown[] }[] }>("select groups from standing where kind = 'teams'");
    expect(row.groups[0].rows).toHaveLength(1);
  });
});
