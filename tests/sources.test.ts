import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { espn, espnTeamId, monthRange, parseEspnEvent } from "@/collector/sources/espn";
import { parseJolpica, parseOpenF1 } from "@/collector/sources/f1";
import { markConditional, parseKboMonth, type KboGame } from "@/collector/sources/kbo";
import { parseKbl, type KblGame } from "@/collector/sources/kbl";
import { parseLolEvent } from "@/collector/sources/lolesports";
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
      FirstPractice: { date: "2026-10-23", time: "17:30:00Z" },
      SprintQualifying: { date: "2026-10-23", time: "19:00:00Z" },
    },
    {
      season: "2026",
      round: "19",
      raceName: "Mexico City Grand Prix",
      date: "2026-11-01",
      Circuit: { circuitName: "Autódromo Hermanos Rodríguez" },
    },
  ];

  it("Jolpica: 결승·예선·연습 주행·스프린트 예선을 제목 토큰이 있는 이벤트로 만든다", () => {
    const [race, quali, fp1, sq, mexico] = parseJolpica(races);
    expect(race).toMatchObject({
      externalId: "2026-18-race",
      title: "@f1:United States Grand Prix:race",
      roundLabel: "@round:18",
      home: { externalId: "f1" },
      away: null,
      startAt: "2026-10-25T20:00:00.000Z",
      status: "scheduled",
    });
    expect(quali).toMatchObject({ externalId: "2026-18-quali", title: "@f1:United States Grand Prix:qualifying" });
    expect(fp1).toMatchObject({ externalId: "2026-18-fp1", title: "@f1:United States Grand Prix:fp1", startAt: "2026-10-23T17:30:00.000Z" });
    expect(sq).toMatchObject({ externalId: "2026-18-sq", title: "@f1:United States Grand Prix:sprint_qualifying" });
    // 시각이 없으면 날짜만, 시간 미정
    expect(mexico).toMatchObject({ startAt: null, dateOnly: "2026-11-01", status: "time_tbd" });
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

    it("OpenF1 세션은 2시간 안의 같은 시리즈·같은 세션 이벤트에 연결되고, 다른 세션과는 섞이지 않는다", async () => {
      await upsertMatches(db, f1Id, "jolpica", parseJolpica(races.slice(0, 1)));
      const openf1 = parseOpenF1(
        [
          { session_key: 1, session_name: "Race", date_start: "2026-10-25T20:00:00+00:00", meeting_key: 9, circuit_short_name: "Austin", year: 2026 },
          { session_key: 2, session_name: "Qualifying", date_start: "2026-10-24T21:00:00+00:00", meeting_key: 9, circuit_short_name: "Austin", year: 2026 },
          // 스프린트 예선이 (출처마다 시각이 달라) 연습 주행에 더 가까워도 연습 주행과 섞이지 않는다
          { session_key: 4, session_name: "Sprint Qualifying", date_start: "2026-10-23T18:00:00+00:00", meeting_key: 9, circuit_short_name: "Austin", year: 2026 },
          { session_key: 3, session_name: "Practice 1", date_start: "2026-10-23T17:30:00+00:00", meeting_key: 9, circuit_short_name: "Austin", year: 2026 },
          { session_key: 5, session_name: "Team Photo", date_start: "2026-10-23T16:00:00+00:00", meeting_key: 9, circuit_short_name: "Austin", year: 2026 },
        ],
        [{ meeting_key: 9, meeting_name: "United States Grand Prix" }],
      );
      expect(openf1).toHaveLength(4); // 세션이 아닌 일정은 제외
      const r = await upsertMatches(db, f1Id, "openf1", openf1);
      expect(r.inserted).toBe(0);
      const rows = await db.query<{ title: string; n: number }>(
        `select m.title, count(r.*)::int as n from match m join match_source_ref r on r.match_id = m.id
         group by m.id, m.title order by m.title`,
      );
      expect(rows).toEqual([
        { title: "@f1:United States Grand Prix:fp1", n: 2 },
        { title: "@f1:United States Grand Prix:qualifying", n: 2 },
        { title: "@f1:United States Grand Prix:race", n: 2 },
        { title: "@f1:United States Grand Prix:sprint_qualifying", n: 2 },
      ]);
      // 같은 세션끼리 연결됐는지 (소스 경기 ID 기준)
      const pairs = await db.query<{ ids: string }>(
        `select string_agg(external_id, ',' order by source) as ids from match_source_ref group by match_id order by 1`,
      );
      expect(pairs.map((p) => p.ids)).toEqual(["2026-18-fp1,3", "2026-18-quali,2", "2026-18-race,1", "2026-18-sq,4"]);
    });
  });
});

describe("LoL (lolesports)", () => {
  it("팀 약칭을 ID로, TBD는 대진 미정, 라운드에 경기 방식을 붙인다", () => {
    const base = {
      startTime: "2026-10-23T17:00:00Z",
      state: "unstarted",
      type: "match",
      blockName: "Swiss",
      match: {
        id: "115660540726095005",
        teams: [
          { name: "Gen.G Esports", code: "GEN" },
          { name: "Invictus Gaming", code: "IG" },
        ],
        strategy: { type: "bestOf", count: 1 },
      },
    };
    expect(parseLolEvent(base)).toMatchObject({
      externalId: "115660540726095005",
      season: "2026",
      roundLabel: "@lol:swiss|@bo:1",
      home: { externalId: "GEN" },
      away: { externalId: "IG" },
      status: "scheduled",
    });
    const tbd = parseLolEvent({
      ...base,
      blockName: "Finals",
      match: { ...base.match, teams: [{ name: "TBD", code: "TBD" }, { name: "TBD", code: "TBD" }], strategy: { type: "bestOf", count: 5 } },
    });
    expect(tbd).toMatchObject({ home: null, away: null, status: "draw_pending", roundLabel: "@lol:finals|@bo:5" });
    expect(parseLolEvent({ ...base, type: "show" })).toBeNull();
  });
});

describe("KBO 공식 사이트", () => {
  // 실제 응답(2026-04, 2026-10 포스트시즌)에서 가져온 줄 형태
  const cell = (Text: string, Class: string | null = null) => ({ Text, Class });
  const link = (id: string) => cell(`<a href='/Schedule/GameCenter/Main.aspx?gameDate=${id.slice(0, 8)}&gameId=${id}&section=REVIEW'>리뷰</a>`, "relay");
  const play = (away: string, home: string) => cell(`<span>${away}</span><em><span>vs</span></em><span>${home}</span>`, "play");

  it("원정 vs 홈 순서, 날짜 이어 쓰기, 공식 경기 ID, 우천취소, 이동일", () => {
    const rows = [
      { row: [cell("04.09(목)", "day"), cell("<b>18:30</b>", "time"), play("키움", "두산"), cell("", "relay"), cell(""), cell("SPO-2T"), cell(""), cell("잠실"), cell("우천취소")] },
      { row: [cell("<b>18:30</b>", "time"), play("KIA", "LG"), link("20260409HTLG0"), cell(""), cell("KN-T"), cell(""), cell("잠실2"), cell("-")] },
      { row: [cell("04.10(금)", "day"), cell(""), cell(""), cell(""), cell(""), cell(""), cell(""), cell(""), cell("이동일")] },
    ];
    const [rain, game] = parseKboMonth({ rows }, 2026, false);
    expect(rain).toMatchObject({
      externalId: "20260409WOOB0",
      home: { externalId: "OB" },
      away: { externalId: "WO" },
      status: "postponed",
      venue: "잠실",
    });
    expect(game).toMatchObject({
      externalId: "20260409HTLG0",
      startAt: "2026-04-09T09:30:00.000Z",
      home: { externalId: "LG", name: "LG" },
      away: { externalId: "HT", name: "KIA" },
      status: "scheduled",
      roundLabel: null,
    });
    expect(parseKboMonth({ rows }, 2026, false)).toHaveLength(2);
  });

  it("포스트시즌은 비고의 라운드를 쓰고, 더블헤더는 끝자리 번호로 구분한다", () => {
    const rows = [
      { row: [cell("10.14(수)", "day"), cell("<b>18:30</b>", "time"), play("두산", "LG"), cell("", "relay"), cell(""), cell(""), cell(""), cell("잠실"), cell("WC 1차전")] },
      { row: [cell("<b>14:00</b>", "time"), play("두산", "LG"), cell("", "relay"), cell(""), cell(""), cell(""), cell("잠실"), cell("WC 2차전")] },
    ];
    const [g1, g2] = parseKboMonth({ rows }, 2026, true);
    expect(g1).toMatchObject({ externalId: "20261014OBLG1", roundLabel: "@series:kbo_wc|@game:1" });
    expect(g2).toMatchObject({ externalId: "20261014OBLG2", roundLabel: "@series:kbo_wc|@game:2" });
  });

  it("5전 3선승에서 아직 필요 없는 4·5차전은 '진출 시', 2승 1패가 되면 4차전은 확정", () => {
    const game = (no: number, winner: string | null): KboGame => ({
      externalId: `po${no}`,
      season: "2026",
      roundLabel: `@series:kbo_po|@game:${no}`,
      home: { externalId: "SS", name: "삼성" },
      away: { externalId: "HT", name: "KIA" },
      startAt: `2026-10-${24 + no}T09:30:00.000Z`,
      status: "scheduled",
      winner,
    });
    const before = markConditional([1, 2, 3, 4, 5].map((n) => game(n, null)));
    expect(before.map((g) => g.status)).toEqual(["scheduled", "scheduled", "scheduled", "conditional", "conditional"]);
    const after = markConditional([game(1, "SS"), game(2, "HT"), game(3, "SS"), game(4, null), game(5, null)]);
    expect(after.map((g) => g.status).slice(3)).toEqual(["scheduled", "conditional"]);
    // 와일드카드(2경기): 2차전은 1차전 결과에 달려 있다
    const wc = markConditional([1, 2].map((n) => ({ ...game(n, null), roundLabel: `@series:kbo_wc|@game:${n}` })));
    expect(wc.map((g) => g.status)).toEqual(["scheduled", "conditional"]);
  });

  it("끝난 경기의 승리 팀을 점수 표시에서 읽는다", () => {
    const rows = [
      {
        row: [
          cell("10.17(토)", "day"),
          cell("<b>14:00</b>", "time"),
          cell('<span>LG</span><em><span class="lose">1</span><span>vs</span><span class="win">5</span></em><span>KIA</span>', "play"),
          cell(""),
          cell("광주"),
          cell("-"),
        ],
      },
    ];
    expect(parseKboMonth({ rows }, 2026, true)[0].winner).toBe("HT");
  });
});

describe("KBL 공식 홈페이지", () => {
  // 실제 응답(api.kbl.or.kr/match/list) 모양
  const g = (over: Partial<KblGame>): KblGame => ({
    gmkey: "S49G01N1",
    gameDate: "20261003",
    gameStart: "1400",
    gameNo: 1,
    seasonGrade: 1,
    seasonCategory: "R",
    seasonName1: "2026-2027",
    tcodeH: "60",
    tcodeA: "50",
    tnameH: "부산 KCC",
    tnameA: "창원 LG",
    stadiumnameF: "부산사직체육관",
    isEnded: 0,
    scoreH: null,
    scoreA: null,
    ...over,
  });

  it("정규시즌 1군 경기만 남기고 한국 시간을 UTC로", () => {
    const out = parseKbl([
      g({}),
      g({ gmkey: "D1", seasonGrade: 2, seasonCategory: "D1" }), // D리그
      g({ gmkey: "EA1", seasonCategory: "EA", tcodeH: "757", tnameH: "나가사키 벨카" }), // EASL
      g({ gmkey: "OM1", seasonCategory: "OM" }), // 시범 경기
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      externalId: "S49G01N1",
      season: "2026-27",
      roundLabel: null,
      home: { externalId: "60" },
      away: { externalId: "50" },
      startAt: "2026-10-03T05:00:00.000Z",
      venue: "부산사직체육관",
      status: "scheduled",
    });
  });

  it("플레이오프: 6강(1~10번)·4강(11~20번)을 시리즈별 차전으로, 남은 경기는 승패로 '진출 시' 계산", () => {
    const po = (no: number, h: string, a: string, sh: number | null = null, sa: number | null = null) =>
      g({ gmkey: `S47G03N${no}`, gameNo: no, seasonCategory: "PO", tcodeH: h, tcodeA: a, isEnded: sh == null ? 0 : 1, scoreH: sh, scoreA: sa });
    const out = parseKbl([
      // 6강: SK(55)-소노(66) 두 경기 SK 2승, DB(16)-KCC(60) 아직 시작 전
      po(1, "55", "66", 80, 70),
      po(2, "16", "60"),
      po(3, "55", "66", 75, 60),
      po(4, "16", "60"),
      po(5, "66", "55"),
      po(6, "60", "16"),
      po(7, "55", "66"),
      po(9, "66", "55"),
      // 4강
      po(11, "50", "66"),
    ]);
    const byId = Object.fromEntries(out.map((m) => [m.externalId, m]));
    expect(byId.S47G03N1.roundLabel).toBe("@series:kbl_6po|@game:1");
    expect(byId.S47G03N3.roundLabel).toBe("@series:kbl_6po|@game:2");
    expect(byId.S47G03N2.roundLabel).toBe("@series:kbl_6po|@game:1");
    expect(byId.S47G03N11.roundLabel).toBe("@series:kbl_4po|@game:1");
    // SK 2승: 3차전은 확정, 4·5차전은 진출 시
    expect(byId.S47G03N5.status).toBe("scheduled");
    expect(byId.S47G03N7.status).toBe("conditional");
    expect(byId.S47G03N9.status).toBe("conditional");
    // 시작 전 시리즈: 1~3차전 확정
    expect([byId.S47G03N2, byId.S47G03N4, byId.S47G03N6].map((m) => m.status)).toEqual(["scheduled", "scheduled", "scheduled"]);
  });

  it("챔피언결정전은 7전 4선승", () => {
    const cp = (no: number) => g({ gmkey: `CP${no}`, gameNo: no, seasonCategory: "CP" });
    const out = parseKbl([1, 2, 3, 4, 5, 6, 7].map(cp));
    expect(out.map((m) => m.status)).toEqual(["scheduled", "scheduled", "scheduled", "scheduled", "conditional", "conditional", "conditional"]);
    expect(out[4].roundLabel).toBe("@series:kbl_final|@game:5");
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
    expect(ws5).toMatchObject({ status: "conditional", roundLabel: "@series:ws|@game:5", home: { externalId: "158" } });
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
    ).toMatchObject({ status: "conditional", roundLabel: "@playoffs:2|@game:6" });
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
    expect(m).toMatchObject({ roundLabel: "@week:7", isNeutral: true, home: { externalId: "nfl:18" } });
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
      // 치른 경기 결과
      "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.league_cup/teams/359/schedule",
    ]);
    expect(m).toMatchObject({ roundLabel: "Fourth Round", away: { externalId: "359" } });
  });

  it("월 단위 조회 범위", () => {
    expect(monthRange(new Date("2026-10-21T00:00:00Z"), 1, 2)).toEqual(["202609", "202610", "202611", "202612"]);
  });
});
