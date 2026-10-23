import { describe, expect, it } from "vitest";
import {
  parseEspnLeaders,
  parseF1Leaders,
  parseFootballDataScorers,
  parseKblLeaders,
  parseKboLeaders,
  parseKleagueLeaders,
  parseMlbLeaders,
  parseNhlLeaders,
} from "@/collector/leaders";

describe("개인 순위 TOP 5", () => {
  it("KBO TOP5 화면: 부문별 이름·팀·값, 비율은 .371 처럼", () => {
    const li = (r: number, name: string, team: string, v: string) =>
      `<li> <span class='rank${r} name'><a href="/x?playerId=${r}">${name}</a></span> <span class="team">${team}</span> <span class="rr">${v}</span> </li>`;
    const html = `<span class="title">타율 TOP5</span><div class="list"><ol class="rankList">${li(1, "구자욱", "삼성", "0.371")}${li(2, "레이예스", "롯데", "0.363")}</ol>
      <span class="title">홈런 TOP5</span><div class="list"><ol class="rankList">${li(1, "김도영", "KIA", "45")}</ol>`;
    const t = parseKboLeaders(html);
    expect(t.groups.map((g) => g.name)).toEqual(["avg", "hr"]);
    expect(t.groups[0].rows[0]).toMatchObject({ rank: 1, name: "구자욱", ref: { source: "kbo", externalId: "SS" }, stats: { value: ".371" } });
    expect(t.groups[1].rows[0]).toMatchObject({ name: "김도영", ref: { externalId: "HT" }, stats: { value: "45" } });
    expect(() => parseKboLeaders("<html></html>")).toThrow();
  });

  it("KBL·K리그·football-data", () => {
    const kbl = parseKblLeaders([
      { part: "score", list: [{ rank: 1, value: 26.7143, player: { pname: "패리스 배스", tcode: "06", tname: "수원 KT" } }] },
      { part: "fgt", list: [{ rank: 1, value: 10, player: { pname: "x", tcode: "06", tname: "수원 KT" } }] },
    ]);
    expect(kbl.groups).toHaveLength(1);
    expect(kbl.groups[0]).toMatchObject({ name: "ppg", rows: [{ name: "패리스 배스", ref: { externalId: "06" }, stats: { value: "26.7" } }] });

    const p = (rank: number, name: string, g: number, a: number) => ({ rank, name, teamId: "K01", teamName: "울산", goalQty: g, assistQty: a });
    const kl = parseKleagueLeaders([p(1, "야고", 16, 1)], [p(1, "이동경", 11, 12)]);
    expect(kl.groups.map((g) => [g.name, g.rows[0].name, g.rows[0].stats.value])).toEqual([
      ["goals", "야고", "16"],
      ["assists", "이동경", "12"],
    ]);

    const fd = parseFootballDataScorers({
      scorers: [
        { player: { name: "A" }, team: { id: 1, name: "One" }, goals: 8 },
        { player: { name: "B" }, team: { id: 2, name: "Two" }, goals: 8 },
        { player: { name: "C" }, team: { id: 3, name: "Three" }, goals: 5 },
      ],
    });
    // 같은 골 수는 같은 순위
    expect(fd.groups[0].rows.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it("ESPN·MLB·NHL", () => {
    const espn = parseEspnLeaders(
      {
        leaders: {
          categories: [
            {
              name: "pointsPerGame",
              leaders: [{ displayValue: "45.0", value: 45, athlete: { displayName: "Ty Jerome", team: { id: "29", abbreviation: "MEM" } } }],
            },
          ],
        },
      },
      "basketball/nba",
    );
    expect(espn.groups[0]).toMatchObject({ name: "ppg", rows: [{ ref: { externalId: "nba:29" }, stats: { value: "45.0" } }] });

    const mlb = parseMlbLeaders(
      { leagueLeaders: [{ leaderCategory: "homeRuns", leaders: [{ rank: 1, value: "45", person: { fullName: "Kyle Schwarber" }, team: { id: 143, name: "Phillies" } }] }] },
      { leagueLeaders: [{ leaderCategory: "earnedRunAverage", leaders: [{ rank: 1, value: "1.80", person: { fullName: "J" } }] }] },
    );
    expect(mlb.groups.map((g) => g.name)).toEqual(["hr", "era"]);

    const nhl = parseNhlLeaders(
      { goals: [{ firstName: { default: "Kirill" }, lastName: { default: "Kaprizov" }, teamName: { default: "Wild" }, teamAbbrev: "MIN", value: 11 }] },
      { savePctg: [{ firstName: { default: "Linus" }, lastName: { default: "Ullmark" }, value: 0.945 }] },
    );
    expect(nhl.groups.map((g) => [g.name, g.rows[0].name, g.rows[0].stats.value])).toEqual([
      ["goals", "Kirill Kaprizov", "11"],
      ["svPct", "Linus Ullmark", ".945"],
    ]);
  });

  it("F1: 우승·폴·포디움 횟수", () => {
    const r = (id: string) => ({ Results: [{ Driver: { driverId: id, familyName: id }, Constructor: { name: "T" } }] });
    const q = (id: string) => ({ QualifyingResults: [{ Driver: { driverId: id, familyName: id }, Constructor: { name: "T" } }] });
    const t = parseF1Leaders([r("a"), r("a"), r("b")], [r("a"), r("a"), r("b"), r("b"), r("c")], [q("b")]);
    const by = Object.fromEntries(t.groups.map((g) => [g.name, g.rows.map((x) => `${x.driverId}:${x.stats.value}`)]));
    expect(by).toEqual({ f1Wins: ["a:2", "b:1"], f1Poles: ["b:1"], f1Podiums: ["a:2", "b:2", "c:1"] });
    expect(t.groups[2].rows.map((x) => x.rank)).toEqual([1, 1, 3]);
  });
});
