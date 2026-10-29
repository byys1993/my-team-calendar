import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jolpica } from "@/collector/sources/f1";
import type { Podium } from "@/collector/types";
import { upsertMatches } from "@/collector/upsert";
import type { Db } from "@/lib/db";
import { createMemoryDb } from "@/lib/db/pglite";
import { migrate } from "@/lib/db/migrate";
import { seed } from "@/lib/db/seed";
import { F1_PICKS, isMinorF1Session, pickResults } from "@/lib/f1picks";
import { getLeaguePage, getTeamPage, sitemapEntries } from "@/lib/pages";
import { getMatchesForTeams } from "@/lib/schedule";

const row = (pos: number, driverId: string, team: string): Podium => ({ pos, driverId, code: null, name: driverId, team });
const RESULTS = [row(1, "russell", "Mercedes"), row(2, "leclerc", "Ferrari"), row(3, "norris", "McLaren"), row(7, "hamilton", "Ferrari")];

describe("F1 팀·드라이버 고르기", () => {
  it("시드의 F1 팀·드라이버와 코드 목록이 같다", () => {
    const seedFile = JSON.parse(readFileSync("data/seed/f1.json", "utf8")) as { teams: { slug: string; competition: string }[] };
    expect(seedFile.teams.map((t) => t.slug).sort()).toEqual(Object.keys(F1_PICKS).sort());
    expect(seedFile.teams.every((t) => t.competition === "f1")).toBe(true);
  });

  it("전체 순위에서 그 팀(두 드라이버)·드라이버의 줄만", () => {
    expect(pickResults(RESULTS, "f1-hamilton").map((r) => r.pos)).toEqual([7]);
    expect(pickResults(RESULTS, "f1-ferrari").map((r) => r.driverId)).toEqual(["leclerc", "hamilton"]);
    expect(pickResults(RESULTS, "arsenal")).toEqual([]);
    expect(pickResults(null, "f1-hamilton")).toEqual([]);
  });

  describe("DB", () => {
    let db: Db & { close(): Promise<void> };
    beforeEach(async () => {
      db = await createMemoryDb();
      await migrate(db);
      const f1Seed = JSON.parse(readFileSync("data/seed/f1.json", "utf8")) as { teams: Parameters<typeof seed>[1]["teams"] };
      await seed(db, {
        sports: [
          { slug: "motorsport", name_ko: "모터스포츠" },
          { slug: "soccer", name_ko: "축구" },
        ],
        competitions: [
          { slug: "f1", sport: "motorsport", name_ko: "F1", type: "motorsport" },
          { slug: "epl", sport: "soccer", name_ko: "프리미어리그", type: "league" },
        ],
        teams: [
          { slug: "f1", sport: "motorsport", competition: "f1", name_ko: "F1 그랑프리", name_en: "Formula 1", refs: { jolpica: "f1" } },
          { slug: "arsenal", sport: "soccer", competition: "epl", name_ko: "아스널", name_en: "Arsenal" },
          ...f1Seed.teams,
        ],
      });
      const [{ id }] = await db.query<{ id: number }>("select id from competition where slug = 'f1'");
      const start = new Date(Date.now() - 3 * 86_400_000);
      const at = (h: number) => new Date(start.getTime() + h * 3600_000).toISOString();
      const ev = (kind: string, h: number, extra: object = {}) => ({
        externalId: `2026-20-${kind}`,
        season: "2026",
        title: `@f1:Mexico City Grand Prix:${kind}`,
        home: { externalId: "f1", name: "Formula 1" },
        away: null,
        startAt: at(h),
        status: "scheduled" as const,
        ...extra,
      });
      await upsertMatches(db, id, "jolpica", [
        ev("fp1", 0),
        ev("qualifying", 24, { podium: [RESULTS[0]], results: RESULTS }),
        ev("race", 48, { podium: RESULTS.slice(0, 3), results: RESULTS }),
      ]);
    });
    afterEach(() => db.close());

    it("팀·드라이버를 고르면 F1 의 모든 세션(연습 주행 포함)과 그 순위 줄만 받는다", async () => {
      const hamilton = await getMatchesForTeams(db, ["f1-hamilton"], "ko");
      expect(hamilton.map((m) => m.title?.split(":").pop())).toEqual(["fp1", "qualifying", "race"]);
      expect(hamilton[2].mine?.map((r) => [r.driverId, r.pos])).toEqual([["hamilton", 7]]);
      expect(hamilton[0].mine).toBeUndefined(); // 연습 주행은 순위 없음
      expect(hamilton[2]).not.toHaveProperty("results"); // 전체 순위는 보내지 않는다

      const both = await getMatchesForTeams(db, ["f1-ferrari", "f1-norris"], "ko");
      expect(both[2].mine?.map((r) => r.driverId)).toEqual(["leclerc", "norris", "hamilton"]);

      // 시리즈 전체를 고른 경우는 그대로, F1 과 상관없는 팀은 F1 세션을 받지 않는다
      expect(await getMatchesForTeams(db, ["f1"], "ko")).toHaveLength(3);
      expect((await getMatchesForTeams(db, ["f1"], "ko"))[2].mine).toBeUndefined();
      expect(await getMatchesForTeams(db, ["arsenal"], "ko")).toEqual([]);
    });

    it("주요 세션만: 연습 주행·스프린트 예선은 빼고 결승·예선·스프린트만 (화면·구독·알림 메일 공통)", async () => {
      const titles = async (slugs: string[]) =>
        (await getMatchesForTeams(db, slugs, "ko", { f1MainOnly: true })).map((m) => m.title?.split(":").pop());
      expect(await titles(["f1-hamilton"])).toEqual(["qualifying", "race"]);
      expect(await titles(["f1"])).toEqual(["qualifying", "race"]);
      expect(isMinorF1Session({ competition: "f1", title: "@f1:Qatar Grand Prix:sprint_qualifying" })).toBe(true);
      expect(isMinorF1Session({ competition: "f1", title: "@f1:Qatar Grand Prix:sprint" })).toBe(false);
      expect(isMinorF1Session({ competition: "epl", title: null })).toBe(false);
    });

    it("시리즈 전체(f1)는 리그 페이지 팀 목록·사이트맵에서 빼고, 페이지 자체는 그대로", async () => {
      expect((await sitemapEntries(db)).teams).not.toContain("f1");
      expect((await sitemapEntries(db)).teams).toContain("f1-hamilton");
      expect((await getLeaguePage(db, "f1", "ko"))?.teams.map((t) => t.slug)).not.toContain("f1");
      expect((await getTeamPage(db, "f1-hamilton", "ko"))?.leagueTeams.map((t) => t.slug)).not.toContain("f1");
      expect((await getTeamPage(db, "f1", "ko"))?.team.slug).toBe("f1");
    });

    it("드라이버 페이지: 드라이버 순위표에서 순위를 찾는다", async () => {
      await db.query(
        `insert into standing (competition_id, kind, season, groups, source)
         select id, 'drivers', '2026', $1::text::jsonb, 'jolpica' from competition where slug = 'f1'`,
        [
          JSON.stringify([
            {
              name: null,
              rows: [
                { rank: 1, team: null, name: "Russell", driverId: "russell", stats: {} },
                { rank: 2, team: null, name: "Hamilton", driverId: "hamilton", stats: {} },
              ],
            },
          ]),
        ],
      );
      const p = await getTeamPage(db, "f1-hamilton", "ko");
      expect(p?.team.name).toBe("루이스 해밀턴");
      expect(p?.standing).toMatchObject({ rank: 2, size: 2 });
      expect(p?.recent.length).toBe(3);
    });
  });

  it("Jolpica 결과는 쪽을 넘겨 시즌 전체를 받는다", async () => {
    const urls: string[] = [];
    const res = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    const fetcher = async (url: string) => {
      urls.push(url);
      if (url.includes("/races/")) {
        return res({
          MRData: {
            RaceTable: {
              Races: [
                {
                  season: "2026",
                  round: "1",
                  raceName: "Australian Grand Prix",
                  date: "2026-03-08",
                  time: "04:00:00Z",
                  Circuit: { circuitName: "Albert Park" },
                },
              ],
            },
          },
        });
      }
      const offset = Number(new URL(url).searchParams.get("offset"));
      const isRace = url.includes("/results/");
      const r = (pos: number) => ({
        position: String(pos),
        Driver: { driverId: `d${pos}`, familyName: `D${pos}` },
        Constructor: { name: "T" },
      });
      return res({
        MRData: {
          total: isRace ? "150" : "0",
          RaceTable: { Races: isRace ? [{ season: "2026", round: "1", Results: offset === 0 ? [r(1), r(2), r(3)] : [r(4)] }] : [] },
        },
      });
    };
    const [race] = await jolpica(fetcher, { delayMs: 0 }).fetchMatches("2026");
    expect(urls.filter((u) => u.includes("/results/"))).toHaveLength(2); // 150줄 → 두 쪽
    expect(race.results?.map((p) => p.pos)).toEqual([1, 2, 3, 4]);
    expect(race.podium?.map((p) => p.pos)).toEqual([1, 2, 3]);
  });
});
