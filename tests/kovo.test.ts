import { describe, expect, it } from "vitest";
import { parseKovoLeaders } from "@/collector/leaders";
import { kovo, parseKovo, type KovoGame } from "@/collector/sources/kovo";
import { fetchStandings, parseKovoStandings } from "@/collector/standings";
import { parseKovo as parseKovoBox, type KovoPlayer } from "@/lib/boxscoreKr";

const game = (x: Partial<KovoGame>): KovoGame => ({
  seasonCode: "023",
  seasonName: "HK흥국금융 2026~2027 V-리그",
  leagueCode: "201",
  round: 1,
  gnum: 2,
  hcode: "2005",
  hname: "GS칼텍스 서울KIXX",
  hsname: "GS칼텍스",
  acode: "2002",
  aname: "한국도로공사 하이패스 배구단",
  asname: "한국도로공사",
  gdate: "2026-11-05",
  gstime: "19:00",
  hspoint: 0,
  aspoint: 0,
  place: "서울장충체육관",
  gtv: "KBSN Sports,NAVER,SOOP",
  ...x,
});

// 받은 주소에 맞는 응답을 돌려주는 가짜 출처
const server = (routes: [RegExp, unknown][]) => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string> });
    const route = routes.find(([re]) => re.test(url));
    return new Response(JSON.stringify({ result: { status: route ? 200 : 500, message: "" }, payload: route?.[1] ?? null }));
  };
  return { fetcher, calls };
};

describe("V-리그 일정", () => {
  it("정규리그 경기: 시즌·라운드·KST 시각·경기장·중계, 끝나지 않은 경기는 점수 없음", () => {
    const [m] = parseKovo([game({})]);
    expect(m).toMatchObject({
      externalId: "023-201-2",
      season: "2026-27",
      roundLabel: "@round:1",
      home: { externalId: "2005" },
      away: { externalId: "2002" },
      startAt: "2026-11-05T10:00:00.000Z",
      status: "scheduled",
      venue: "서울장충체육관",
      broadcast: "KBSN Sports, NAVER, SOOP",
    });
    expect(m.homeScore).toBeUndefined();
  });

  it("세트 스코어를 점수로, 3세트를 먼저 딴 경기만 끝난 것으로 본다", () => {
    const [done, live] = parseKovo([game({ hspoint: 3, aspoint: 2 }), game({ gnum: 3, hspoint: 2, aspoint: 1 })]);
    expect(done).toMatchObject({ homeScore: 3, awayScore: 2 });
    expect(live.homeScore).toBeUndefined();
  });

  it("시간이 없으면 날짜만, 시범경기·올스타전과 팀이 정해지지 않은 경기는 뺀다", () => {
    const list = parseKovo([
      game({ gstime: "" }),
      game({ gnum: 9, leagueCode: "801" }),
      game({ gnum: 8, leagueCode: "901" }),
      game({ gnum: 7, leagueCode: "202", hcode: "" }),
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ startAt: null, dateOnly: "2026-11-05", status: "time_tbd" });
  });

  it("포스트시즌: 단계·N차전, 시리즈가 끝나면 열리지 않을 수 있는 경기는 '진출 시'", () => {
    const po = (gnum: number, x: Partial<KovoGame> = {}) => game({ leagueCode: "202", gnum, ...x });
    const list = parseKovo([po(254), po(255), po(253, { hspoint: 3, aspoint: 1 })]);
    expect(list.map((m) => [m.externalId, m.roundLabel, m.status])).toEqual([
      ["023-202-254", "@series:kbo_po|@game:2", "scheduled"],
      ["023-202-255", "@series:kbo_po|@game:3", "conditional"],
      ["023-202-253", "@series:kbo_po|@game:1", "scheduled"],
    ]);
    expect(parseKovo([game({ leagueCode: "204" })])[0]).toMatchObject({ roundLabel: "@series:kbo_semi|@game:1", status: "scheduled" });
    expect(parseKovo([game({ leagueCode: "203", gnum: 260 })])[0].roundLabel).toBe("@series:kbl_final|@game:1");
  });

  it("현재 시즌 전체를 받아 앞으로의 기간을 빠짐없이 준 것으로 표시하고, 팀 이름을 한국어로 요청한다", async () => {
    const { fetcher, calls } = server([
      [/main\/game\/season/, { seasonCode: "023" }],
      [/game-schedule\?seasonCode=023&gender=2/, { content: [game({})] }],
    ]);
    const list = await kovo(fetcher, () => new Date("2026-11-04T00:00:00Z")).fetchMatches("2");
    expect(list).toHaveLength(1);
    expect(list.coverage).toEqual([{ from: "2026-11-04T00:00:00.000Z", to: "2027-11-04T00:00:00.000Z" }]);
    expect(calls[1].headers["Accept-Language"]).toBe("ko");
  });

  it("새 시즌 일정이 아직 없으면 지난 시즌을 받는다", async () => {
    const { fetcher } = server([
      [/main\/game\/season/, { seasonCode: "024" }],
      [/seasonCode=024/, { content: [] }],
      [/seasonCode=023/, { content: [game({})] }],
    ]);
    expect((await kovo(fetcher).fetchMatches("1")).map((m) => m.externalId)).toEqual(["023-201-2"]);
  });

  it("HTTP 200 이어도 본문이 실패면 실패로 처리한다", async () => {
    await expect(kovo(server([]).fetcher).fetchMatches("1")).rejects.toThrow("KOVO 500");
  });
});

describe("V-리그 순위", () => {
  it("승점은 winp, 득실은 세트 득실", () => {
    const t = parseKovoStandings([{ rank: 1, tcode: "2005", tsname: "GS칼텍스", win: 2, lost: 1, swin: 7, slost: 4, winp: 6 }]);
    expect(t.groups[0].rows[0]).toMatchObject({
      ref: { source: "kovo", externalId: "2005" },
      stats: { gp: 3, w: 2, l: 1, gd: 3, pts: 6 },
    });
  });

  it("남녀를 나눠 현재 시즌 정규리그를 요청한다", async () => {
    const { fetcher, calls } = server([
      [/main\/game\/season/, { seasonCode: "023" }],
      [/team-rank/, []],
    ]);
    await fetchStandings({ source: "kovo", gender: "2" }, { fetcher });
    expect(calls[1].url).toContain("/stat/league/team-rank?seasonCode=023&gender=2&leagueCode=201&round=0");
  });

  it("개인 순위: 득점은 합계, 공격·리시브는 %, 나머지는 세트당. 기록이 없는 부문은 뺀다", () => {
    const row = (sup: number) => [{ rank: 1, pname: "실바", tcode: "2005", tsname: "GS칼텍스", sup }];
    const t = parseKovoLeaders({ point: row(27), at: row(60), b: row(1), r: [] });
    expect(t.groups.map((g) => [g.name, g.rows[0].stats.value])).toEqual([
      ["vbPoints", "27"],
      ["vbAttack", "60.00%"],
      ["vbBlock", "1.00"],
    ]);
    expect(t.groups[0].rows[0]).toMatchObject({ name: "실바", sub: "GS칼텍스", ref: { source: "kovo", externalId: "2005" } });
  });
});

describe("V-리그 기록지", () => {
  const player = (x: Partial<KovoPlayer>): KovoPlayer => ({
    tcode: "2005",
    pname: "실바",
    position: "OP",
    ynS1: "-1",
    ynS2: "-1",
    ynS3: "-1",
    ynS4: "-2",
    ynS5: "-2",
    point: 27,
    att: 40,
    ats: 24,
    atsp: 60,
    ss: 2,
    bs: 1,
    ds: 6,
    sets: 0,
    rt: 0,
    rsp: 0,
    err: 5,
    ...x,
  });
  const box = parseKovoBox({
    game: {
      hcode: "2005",
      acode: "2002",
      spectators: 3607,
      sptime: "01:23",
      hs1point: 25,
      hs2point: 25,
      hs3point: 25,
      hs4point: 0,
      hs5point: 0,
      as1point: 18,
      as2point: 21,
      as3point: 22,
      as4point: 0,
      as5point: 0,
    },
    player: [
      player({ pname: "교체", ynS1: "18", ynS2: "-2", ynS3: "-2", point: 30 }),
      player({}),
      player({ pname: "안 뜀", ynS1: "-2", ynS2: "-2", ynS3: "-2" }),
      player({ tcode: "2002", pname: "모마" }),
    ],
    team: [
      { tcode: "2002", point: 61, att: 96, ats: 43, atsp: 44.79, ss: 0, bs: 7, ds: 50, sets: 41, rt: 68, rsp: 30.88235, err: 10 },
      { tcode: "2005", point: 75, att: 100, ats: 55, atsp: 55, ss: 4, bs: 6, ds: 53, sets: 51, rt: 56, rsp: 44.64285, err: 11 },
    ],
  });

  it("치른 세트만 세트별 점수로, 관중·경기 시간", () => {
    expect(box.line).toEqual({ labels: ["1", "2", "3", "T"], home: ["25", "25", "25", "75"], away: ["18", "21", "22", "61"] });
    expect(box.info).toEqual({ crowd: "3,607", duration: "1:23" });
  });

  it("팀 기록은 홈·원정 팀에 맞게", () => {
    expect(box.stats.find((s) => s.key === "vbAttackPct")).toEqual({ key: "vbAttackPct", home: "55%", away: "44.8%" });
    expect(box.stats.find((s) => s.key === "vbReceivePct")).toEqual({ key: "vbReceivePct", home: "44.6%", away: "30.9%" });
  });

  it("뛴 선수만, 선발 먼저. 시도가 없는 비율은 '-', 합계는 팀 기록", () => {
    expect(box.home[0].rows.map((r) => [r.name, r.sub])).toEqual([
      ["실바", false],
      ["교체", true],
    ]);
    expect(box.home[0].rows[0].stats).toEqual(["27", "24-40", "60", "2", "1", "6", "0", "-", "5"]);
    expect(box.home[0].totals?.[0]).toBe("75");
    expect(box.away[0].rows.map((r) => r.name)).toEqual(["모마"]);
  });
});
