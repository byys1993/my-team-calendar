import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { espn, espnTeamId, monthRange, parseEspnEvent } from "@/collector/sources/espn";
import { gpKo, parseJolpica, parseOpenF1 } from "@/collector/sources/f1";
import { parseMlb } from "@/collector/sources/mlb";
import { parseNhlGame } from "@/collector/sources/nhl";
import { upsertMatches } from "@/collector/upsert";
import type { Db } from "@/lib/db";
import { createMemoryDb } from "@/lib/db/pglite";
import { migrate } from "@/lib/db/migrate";
import { seed } from "@/lib/db/seed";

describe("F1", () => {
  const races = [
    {
      season: "2026",
      round: "18",
      raceName: "United States Grand Prix",
      date: "2026-10-25",
      time: "20:00:00Z",
      Circuit: { circuitName: "Circuit of the Americas" },
      Qualifying: { date: "2026-10-24", time: "21:00:00Z" },
    },
    {
      season: "2026",
      round: "19",
      raceName: "Mexico City Grand Prix",
      date: "2026-11-01",
      Circuit: { circuitName: "Autódromo Hermanos Rodríguez" },
    },
  ];

  it("Jolpica: 결승·예선을 한국어 제목의 이벤트로 만든다", () => {
    const [race, quali, mexico] = parseJolpica(races);
    expect(race).toMatchObject({
      externalId: "2026-18-race",
      title: "미국 GP 결승",
      roundLabel: "18라운드",
      home: { externalId: "f1" },
      away: null,
      startAt: "2026-10-25T20:00:00.000Z",
      status: "scheduled",
    });
    expect(quali).toMatchObject({ externalId: "2026-18-quali", title: "미국 GP 예선" });
    // 시각이 없으면 날짜만, 시간 미정
    expect(mexico).toMatchObject({ startAt: null, dateOnly: "2026-11-01", status: "time_tbd" });
    expect(gpKo("Some New Grand Prix")).toBe("Some New GP");
  });

  describe("소스 간 같은 세션 연결", () => {
    let db: Db & { close(): Promise<void> };
    let f1Id: number;
    beforeEach(async () => {
      db = await createMemoryDb();
      await migrate(db);
      await seed(db, {
        sports: [{ slug: "motorsport", name_ko: "모터스포츠" }],
        competitions: [{ slug: "f1", sport: "motorsport", name_ko: "F1", type: "motorsport" }],
        teams: [
          {
            slug: "f1",
            sport: "motorsport",
            competition: "f1",
            name_ko: "F1 그랑프리",
            name_en: "Formula 1",
            refs: { jolpica: "f1", openf1: "f1" },
          },
        ],
      });
      [{ id: f1Id }] = await db.query<{ id: number }>("select id from competition where slug = 'f1'");
    });
    afterEach(() => db.close());

    it("OpenF1 세션은 2시간 안의 같은 시리즈 이벤트에 연결되고, 다른 세션과는 섞이지 않는다", async () => {
      await upsertMatches(db, f1Id, "jolpica", parseJolpica(races.slice(0, 1)));
      const openf1 = parseOpenF1(
        [
          { session_key: 1, session_name: "Race", date_start: "2026-10-25T20:00:00+00:00", meeting_key: 9, circuit_short_name: "Austin", year: 2026 },
          { session_key: 2, session_name: "Qualifying", date_start: "2026-10-24T21:00:00+00:00", meeting_key: 9, circuit_short_name: "Austin", year: 2026 },
          { session_key: 3, session_name: "Practice 1", date_start: "2026-10-23T17:30:00+00:00", meeting_key: 9, circuit_short_name: "Austin", year: 2026 },
        ],
        [{ meeting_key: 9, meeting_name: "United States Grand Prix" }],
      );
      expect(openf1).toHaveLength(2); // 연습 주행은 제외
      const r = await upsertMatches(db, f1Id, "openf1", openf1);
      expect(r.inserted).toBe(0);
      const rows = await db.query<{ title: string; n: number }>(
        `select m.title, count(r.*)::int as n from match m join match_source_ref r on r.match_id = m.id
         group by m.id, m.title order by m.title`,
      );
      expect(rows).toEqual([
        { title: "미국 GP 결승", n: 2 },
        { title: "미국 GP 예선", n: 2 },
      ]);
    });
  });
});

describe("MLB", () => {
  const game = (over: Record<string, unknown>) => ({
    gamePk: 1,
    gameDate: "2026-10-29T00:00:00Z",
    officialDate: "2026-10-28",
    season: "2026",
    gameType: "W",
    seriesDescription: "World Series",
    seriesGameNumber: 5,
    ifNecessary: "N",
    status: { detailedState: "Scheduled", startTimeTBD: false },
    teams: { home: { team: { id: 158, name: "Milwaukee Brewers" } }, away: { team: { id: 139, name: "Tampa Bay Rays" } } },
    venue: { name: "American Family Field" },
    ...over,
  });

  it("필요 시 열리는 포스트시즌 경기는 '진출 시', 시간 미정은 날짜만", () => {
    const [ws5, tbd, ppd] = parseMlb({
      dates: [
        {
          games: [
            game({ ifNecessary: "Y" }),
            game({ gamePk: 2, gameType: "R", status: { detailedState: "Scheduled", startTimeTBD: true } }),
            game({ gamePk: 3, gameType: "R", status: { detailedState: "Postponed" } }),
          ],
        },
      ],
    });
    expect(ws5).toMatchObject({ status: "conditional", roundLabel: "월드시리즈 5차전", home: { externalId: "158" } });
    expect(tbd).toMatchObject({ status: "time_tbd", startAt: null, dateOnly: "2026-10-28", roundLabel: null });
    expect(ppd.status).toBe("postponed");
  });
});

describe("NHL", () => {
  it("정규시즌·플레이오프만 남기고 팀 이름을 합친다", () => {
    const base = {
      id: 2026020152,
      season: 20262027,
      gameType: 2,
      startTimeUTC: "2026-10-21T23:30:00Z",
      gameScheduleState: "OK",
      venue: { default: "KeyBank Center" },
      homeTeam: { id: 7, abbrev: "BUF", placeName: { default: "Buffalo" }, commonName: { default: "Sabres" } },
      awayTeam: { id: 4, abbrev: "PHI", placeName: { default: "Philadelphia" }, commonName: { default: "Flyers" } },
    };
    expect(parseNhlGame(base)).toMatchObject({
      season: "2026-27",
      home: { externalId: "7", name: "Buffalo Sabres" },
      status: "scheduled",
    });
    expect(parseNhlGame({ ...base, gameType: 1 })).toBeNull();
    expect(parseNhlGame({ ...base, gameScheduleState: "PPD" })?.status).toBe("postponed");
    expect(
      parseNhlGame({ ...base, gameType: 3, ifNecessary: true, seriesStatus: { round: 2, gameNumberOfSeries: 6 } }),
    ).toMatchObject({ status: "conditional", roundLabel: "플레이오프 2라운드 6차전" });
  });
});

describe("ESPN 미국 리그", () => {
  it("팀 ID에 리그를 붙이고 주차·포스트시즌을 표기한다", () => {
    expect(espnTeamId("basketball/nba", "1")).toBe("nba:1");
    expect(espnTeamId("soccer/eng.1", "359")).toBe("359");
    const m = parseEspnEvent(
      {
        id: "401873011",
        date: "2026-10-25T13:30Z",
        season: { year: 2026, type: 2 },
        week: { number: 7 },
        competitions: [
          {
            neutralSite: true,
            venue: { fullName: "Stade de France" },
            competitors: [
              { homeAway: "home", team: { id: "18", displayName: "New Orleans Saints" } },
              { homeAway: "away", team: { id: "23", displayName: "Pittsburgh Steelers" } },
            ],
          },
        ],
      },
      "football/nfl",
    );
    expect(m).toMatchObject({ roundLabel: "7주차", isNeutral: true, home: { externalId: "nfl:18" } });
  });

  it("TBD 팀은 대진 미정, 시간 미정 경기는 미국 날짜만 남긴다", () => {
    const base = {
      id: "401872910",
      date: "2027-01-16T05:00Z",
      season: { year: 2026, type: 3 },
      competitions: [
        {
          timeValid: false,
          notes: [{ headline: "Wild Card Playoffs" }],
          competitors: [
            { homeAway: "home" as const, team: { id: "-1", displayName: "TBD" } },
            { homeAway: "away" as const, team: { id: "-2", displayName: "TBD" } },
          ],
        },
      ],
    };
    expect(parseEspnEvent(base, "football/nfl")).toMatchObject({
      home: null,
      away: null,
      status: "draw_pending",
      startAt: null,
      dateOnly: "2027-01-16",
      roundLabel: "Wild Card Playoffs",
    });
    const flex = {
      ...base,
      season: { year: 2026, type: 2 },
      competitions: [
        {
          ...base.competitions[0],
          notes: [],
          competitors: [
            { homeAway: "home" as const, team: { id: "18", displayName: "New Orleans Saints" } },
            { homeAway: "away" as const, team: { id: "27", displayName: "Tampa Bay Buccaneers" } },
          ],
        },
      ],
    };
    expect(parseEspnEvent(flex, "football/nfl")).toMatchObject({ status: "time_tbd", dateOnly: "2027-01-16" });
  });

  it("축구 컵대회는 '컵|리그' 형식이면 리그 팀 목록으로 컵 일정을 받는다", async () => {
    const urls: string[] = [];
    const fetcher = async (url: string) => {
      urls.push(url);
      const body = url.endsWith("/teams")
        ? { sports: [{ leagues: [{ teams: [{ team: { id: "359" } }] }] }] }
        : {
            events: [
              {
                id: "1",
                date: "2026-10-27T19:45Z",
                competitions: [
                  {
                    notes: [{ headline: "Fourth Round" }],
                    competitors: [
                      { homeAway: "home", team: { id: "999", displayName: "Fleetwood Town" } },
                      { homeAway: "away", team: { id: "359", displayName: "Arsenal" } },
                    ],
                  },
                ],
              },
            ],
          };
      return new Response(JSON.stringify(body));
    };
    const [m] = await espn(fetcher, { delayMs: 0 }).fetchMatches("soccer/eng.league_cup|eng.1");
    expect(urls).toEqual([
      "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams",
      "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.league_cup/teams/359/schedule?fixture=true",
    ]);
    expect(m).toMatchObject({ roundLabel: "Fourth Round", away: { externalId: "359" } });
  });

  it("월 단위 조회 범위", () => {
    expect(monthRange(new Date("2026-10-21T00:00:00Z"), 1, 2)).toEqual(["202609", "202610", "202611", "202612"]);
  });
});
