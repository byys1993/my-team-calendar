import { describe, expect, it } from "vitest";
import { kleagueMinute, parseKbl, parseKleague, parseKleagueLineup, parseLol, type LolWindow } from "@/lib/boxscoreKr";

describe("KBL 기록지", () => {
  it("쿼터·연장 점수, 관중·경기 시간, 팀 기록, 뛴 선수만(선발 먼저)", () => {
    const rec = (score: number, min: number) => ({
      score,
      playMin: min,
      playSec: 5,
      fgt: 2,
      fgtA: 4,
      threep: 1,
      threepA: 2,
      ft: 0,
      ftA: 0,
      rb: 3,
    });
    const box = parseKbl(
      {
        game: { tcodeH: "55", tcodeA: "60", crowds: 3672, gameTime: 221 },
        teamrecords: {
          home: { scoreq1: 20, scoreq2: 20, scoreq3: 20, scoreq4: 20, scoreeq: [{ score: 10 }] },
          away: { scoreq1: 20, scoreq2: 20, scoreq3: 20, scoreq4: 20, scoreeq: [{ score: 8 }] },
        },
      },
      [
        { player: { pname: "벤치", pos: "GD" }, records: rec(4, 10), homeAway: "1", startFlag: 0 },
        { player: { pname: "워니", pos: "C" }, records: rec(30, 35), homeAway: "1", startFlag: 1 },
        { player: { pname: "못 뜀", pos: "C" }, records: { playMin: 0, playSec: 0 }, homeAway: "1", startFlag: 0 },
        { player: { pname: "허웅", pos: "GD" }, records: rec(20, 36), homeAway: "2", startFlag: 1 },
      ],
      [
        { tcode: "55", records: { score: 90, fgt: 30, fgtA: 60, fbScoreCn: 12 } },
        { tcode: "60", records: { score: 88, fgt: 33, fgtA: 66, fbScoreCn: 4 } },
      ],
    );
    expect(box.line).toEqual({
      labels: ["1", "2", "3", "4", "OT", "T"],
      home: ["20", "20", "20", "20", "10", "90"],
      away: ["20", "20", "20", "20", "8", "88"],
    });
    expect(box.info).toEqual({ crowd: "3,672", duration: "2:21" });
    expect(box.stats.find((s) => s.key === "FG")).toEqual({ key: "FG", home: "30-60", away: "33-66" });
    expect(box.stats.find((s) => s.key === "fastBreak")).toEqual({ key: "fastBreak", home: "12", away: "4" });
    expect(box.home[0].rows.map((r) => [r.name, r.sub, r.stats[0], r.stats[1]])).toEqual([
      ["워니", false, "35:05", "30"],
      ["벤치", true, "10:05", "4"],
    ]);
    expect(box.away[0].rows.map((r) => r.name)).toEqual(["허웅"]);
  });
});

describe("K리그 기록지", () => {
  it("분 표시: 하프 안의 분 → 경기 분, 추가 시간", () => {
    expect(kleagueMinute(1, 32)).toBe("32'");
    expect(kleagueMinute(1, 47)).toBe("45'+2'");
    expect(kleagueMinute(2, 13)).toBe("58'");
    expect(kleagueMinute(2, 48)).toBe("90'+3'");
    expect(kleagueMinute(3, 5)).toBe("95'");
  });

  const html = `
    <tr onclick="playerDetailPop('K09', '1')"><td>25</td><td>GK</td><td> 구성윤</td><td class="home-lineup"></td>
    <p class="hidden changeM_1"></p></tr><script>playerIco('home', '', '1', 'gk', '');</script>
    <tr onclick="playerDetailPop('K09', '2')"><td>22</td><td>DF</td><td> 김진수(c)</td><td></td>
    <p class="hidden changeM_2"></p></tr><script>playerIco('home', '경고', '2', 'df', '');</script>
    <tr onclick="playerDetailPop('K09', '3')"><td>27</td><td>FW</td><td> 문선민</td><td></td>
    <p class="hidden changeM_3">45</p></tr><script>playerIco('home', '교체|득점', '3', 'bc', '');</script>
    <tr onclick="playerDetailPop('K09', '4')"><td>18</td><td>FW</td><td> 조영욱</td><td></td>
    <p class="hidden changeM_4"></p></tr><script>playerIco('home', '', '4', 'bc', '');</script>
    <tr onclick="playerDetailPop('K21', '5')"><td>10</td><td>FW</td><td> 강준혁</td><td></td>
    <p class="hidden changeM_5"></p></tr><script>playerIco('away', '득점', '5', 'fw', '');</script>`;

  it("출전 명단: 선발 + 교체로 들어온 선수 (주장 표시 떼기)", () => {
    expect(parseKleagueLineup(html)).toEqual({
      home: [
        { name: "구성윤", pos: "GK", sub: false },
        { name: "김진수", pos: "DF", sub: false },
        { name: "문선민", pos: "FW", sub: true },
      ],
      away: [{ name: "강준혁", pos: "FW", sub: false }],
    });
  });

  it("골(도움 연결)·경고, 팀 기록, 선수별 골·도움·경고", () => {
    const ev = (eventName: string, halfType: number, timeMin: number, homeOrAway: string, playerName: string) => ({
      eventName,
      halfType,
      timeMin,
      homeOrAway,
      playerName,
    });
    const box = parseKleague(
      {
        firstHalf: [ev("파울", 1, 10, "HOME", "김진수"), ev("경고", 1, 39, "HOME", "김진수")],
        secondHalf: [ev("득점", 2, 13, "HOME", "문선민"), ev("도움", 2, 13, "HOME", "김진수"), ev("득점", 2, 20, "AWAY", "강준혁")],
      },
      { home: { possession: 44, attempts: 9, redCards: 0, doubleYellowCards: 1 }, away: { possession: 56, attempts: 11 } },
      parseKleagueLineup(html),
    );
    expect(box.events).toEqual([
      { min: "39'", side: "home", type: "yellow", player: "김진수" },
      { min: "58'", side: "home", type: "goal", player: "문선민", assist: "김진수" },
      { min: "65'", side: "away", type: "goal", player: "강준혁" },
    ]);
    expect(box.stats.slice(0, 2)).toEqual([
      { key: "possessionPct", home: "44%", away: "56%" },
      { key: "shots", home: "9", away: "11" },
    ]);
    expect(box.stats.find((s) => s.key === "red")).toEqual({ key: "red", home: "1", away: "0" });
    expect(box.home[0].rows.map((r) => [r.name, ...r.stats])).toEqual([
      ["구성윤", "0", "0", "0", "0"],
      ["김진수", "0", "1", "1", "0"],
      ["문선민", "1", "0", "0", "0"],
    ]);
  });
});

describe("LoL 기록지", () => {
  const team = (id: string, n: number, kills: number, towers: number, inhibitors: number) => ({
    meta: {
      esportsTeamId: id,
      participantMetadata: [
        { participantId: n, summonerName: `${id === "gen" ? "GEN" : "HLE"} Player${n}`, championId: "Ryze", role: "mid" },
      ],
    },
    frame: {
      totalGold: 70500,
      inhibitors,
      towers,
      barons: 1,
      totalKills: kills,
      dragons: ["ocean"],
      participants: [{ participantId: n, totalGold: 14600, level: 18, kills: 2, deaths: 3, assists: 3, creepScore: 347 }],
    },
  });
  // 세트마다 진영이 바뀐다
  const window = (blue: ReturnType<typeof team>, red: ReturnType<typeof team>): LolWindow => ({
    gameMetadata: { blueTeamMetadata: blue.meta, redTeamMetadata: red.meta },
    frames: [{ gameState: "finished", blueTeam: blue.frame, redTeam: red.frame }],
  });
  const details = (genWins: number, hleWins: number) => ({
    match: {
      teams: [
        { id: "gen", code: "GEN", result: { gameWins: genWins } },
        { id: "hle", code: "HLE", result: { gameWins: hleWins } },
      ],
      games: [
        { number: 1, id: "g1", state: "completed", teams: [] },
        { number: 2, id: "g2", state: "completed", teams: [] },
      ],
    },
  });
  const windows = new Map([
    [1, window(team("gen", 1, 13, 3, 0), team("hle", 6, 13, 9, 1))], // HLE 승
    [2, window(team("hle", 1, 5, 3, 0), team("gen", 6, 24, 10, 2))], // GEN 승
  ]);

  it("세트별 팀 기록·선수(챔피언·KDA)와 승자 (억제기·타워로 판단, 공식 세트 스코어와 맞을 때)", () => {
    const box = parseLol(details(1, 1), windows);
    expect(box.line).toEqual({ labels: ["1", "2", "T"], home: ["L", "W", "1"], away: ["W", "L", "1"] });
    expect(box.sets?.map((s) => s.winner)).toEqual(["away", "home"]);
    expect(box.sets?.[1].stats[0]).toEqual({ key: "kills", home: "24", away: "5" });
    expect(box.sets?.[0].home[0]).toEqual({ name: "Player1", pos: "MID", note: "Ryze", stats: ["2", "3", "3", "347", "14.6k", "18"] });
  });

  it("판단한 승자가 공식 세트 스코어와 다르면 승패 표시를 하지 않는다", () => {
    const box = parseLol(details(2, 0), windows);
    expect(box.line).toBeNull();
    expect(box.sets?.map((s) => s.winner)).toEqual([null, null]);
  });
});
