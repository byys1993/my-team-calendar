// 경기 기록지(박스스코어): 출처마다 다른 응답을 화면이 그대로 그릴 수 있는 한 가지 모양으로 바꾼다.
// 화면에서도 쓰므로 DB·서버 코드를 가져오지 않는다 (저장·조회는 lib/boxscoreStore.ts).

// 기록지를 볼 수 있는 대회 (1단계: 미국 4대 리그)
export const BOX_COMPETITIONS = new Set(["nba", "nfl", "mlb", "nhl"]);

export interface BoxLine {
  labels: string[]; // '1' '2' … 'OT' 'SO', 끝에 합계 'T' 또는 야구 'R' 'H' 'E'
  away: string[];
  home: string[];
}
export interface BoxRow {
  name: string;
  pos?: string;
  sub?: boolean; // 교체 출전 (들여 쓴다)
  note?: string; // 투수 승·패·세이브 등
  stats: string[];
}
export interface BoxGroup {
  key: string; // 'players' · 'passing' · 'batting' · 'goalies' … (화면에서 번역)
  labels: string[]; // 'PTS' 'REB' 같은 약어는 그대로 쓴다
  rows: BoxRow[];
  totals?: string[];
}
export interface BoxScore {
  source: "espn" | "mlb" | "nhl";
  line: BoxLine | null;
  stats: { key: string; away: string; home: string }[]; // key 가 번역 목록에 없으면 그대로(약어) 보인다
  away: BoxGroup[];
  home: BoxGroup[];
}

type Side = "home" | "away";

// 연장 표기: 정규 기간 다음부터 'OT', '2OT' …
const periodLabel = (i: number, regulation: number) => {
  if (i < regulation) return String(i + 1);
  const n = i - regulation + 1;
  return n === 1 ? "OT" : `${n}OT`;
};

/* ---------------- ESPN (NBA·NFL, MLB·NHL 대체) ---------------- */

interface EspnStat {
  name: string;
  displayValue: string;
}
interface EspnAthlete {
  athlete: { displayName: string; position?: { abbreviation?: string } };
  starter?: boolean;
  didNotPlay?: boolean;
  stats: string[];
}
export interface EspnSummary {
  header: {
    competitions: { competitors: { homeAway: Side; id: string; score?: string; linescores?: { displayValue: string }[] }[] }[];
  };
  boxscore?: {
    teams?: { homeAway?: Side; team: { id: string }; statistics?: EspnStat[] }[];
    players?: {
      team: { id: string };
      statistics: { name?: string; labels: string[]; athletes: EspnAthlete[]; totals?: string[] }[];
    }[];
  };
}

// 팀 기록에서 보여 줄 항목 (ESPN 이름 → 화면 key). 농구는 세계 공통 약어 그대로.
const ESPN_TEAM_STATS: Record<string, [string, string][]> = {
  basketball: [
    ["fieldGoalsMade-fieldGoalsAttempted", "FG"],
    ["fieldGoalPct", "FG%"],
    ["threePointFieldGoalsMade-threePointFieldGoalsAttempted", "3PT"],
    ["threePointFieldGoalPct", "3P%"],
    ["freeThrowsMade-freeThrowsAttempted", "FT"],
    ["totalRebounds", "REB"],
    ["assists", "AST"],
    ["steals", "STL"],
    ["blocks", "BLK"],
    ["totalTurnovers", "TO"],
  ],
  football: [
    ["firstDowns", "firstDowns"],
    ["totalYards", "totalYards"],
    ["netPassingYards", "passingYards"],
    ["rushingYards", "rushingYards"],
    ["thirdDownEff", "thirdDown"],
    ["turnovers", "turnovers"],
    ["totalPenaltiesYards", "penalties"],
    ["possessionTime", "possession"],
  ],
};
const REGULATION: Record<string, number> = { basketball: 4, football: 4, hockey: 3, baseball: 9 };

// path 는 'basketball/nba' 같은 ESPN 경로
export function parseEspn(json: EspnSummary, path: string): BoxScore {
  const sport = path.split("/")[0];
  const competitors = json.header.competitions[0]?.competitors ?? [];
  const sideOf = new Map(competitors.map((c) => [c.id, c.homeAway]));
  const bySide = (side: Side) => competitors.find((c) => c.homeAway === side);

  let line: BoxLine | null = null;
  const home = bySide("home");
  const away = bySide("away");
  if (home?.linescores?.length && away?.linescores?.length) {
    const n = Math.max(home.linescores.length, away.linescores.length);
    const reg = REGULATION[sport] ?? 4;
    const scores = (c: typeof home) => Array.from({ length: n }, (_, i) => c.linescores?.[i]?.displayValue ?? "-");
    line = {
      labels: [...Array.from({ length: n }, (_, i) => (sport === "baseball" ? String(i + 1) : periodLabel(i, reg))), "T"],
      home: [...scores(home), home.score ?? ""],
      away: [...scores(away), away.score ?? ""],
    };
  }

  const stats: BoxScore["stats"] = [];
  const teams = json.boxscore?.teams ?? [];
  const teamOf = (side: Side) => teams.find((t) => (t.homeAway ?? sideOf.get(t.team.id)) === side);
  for (const [name, key] of ESPN_TEAM_STATS[sport] ?? []) {
    const value = (side: Side) => teamOf(side)?.statistics?.find((s) => s.name === name)?.displayValue;
    const h = value("home");
    const a = value("away");
    if (h != null && a != null) stats.push({ key, home: h, away: a });
  }

  const groups = (side: Side): BoxGroup[] => {
    const p = json.boxscore?.players?.find((x) => sideOf.get(x.team.id) === side);
    return (p?.statistics ?? [])
      .map((s) => ({
        key: s.name ?? "players",
        labels: s.labels,
        rows: s.athletes
          .filter((a) => a.stats.length > 0 && !a.didNotPlay)
          .map((a) => ({
            name: a.athlete.displayName,
            pos: a.athlete.position?.abbreviation,
            sub: sport === "basketball" ? !a.starter : undefined,
            stats: a.stats,
          })),
        totals: s.totals?.some(Boolean) ? s.totals : undefined,
      }))
      .filter((g) => g.rows.length > 0);
  };

  return { source: "espn", line, stats, away: groups("away"), home: groups("home") };
}

/* ---------------- MLB Stats API ---------------- */

interface MlbPlayer {
  person: { fullName: string };
  position?: { abbreviation?: string };
  battingOrder?: string; // '100' = 1번 선발, '101' = 1번 자리 첫 교체
  stats: {
    batting?: Record<string, number | string>;
    pitching?: Record<string, number | string> & { note?: string };
  };
  seasonStats?: { batting?: { avg?: string }; pitching?: { era?: string } };
}
interface MlbTeam {
  batters: number[];
  pitchers: number[];
  players: Record<string, MlbPlayer>;
  teamStats: { batting: Record<string, number | string>; pitching: Record<string, number | string> };
}
export interface MlbBox {
  teams: { home: MlbTeam; away: MlbTeam };
}
export interface MlbLinescore {
  innings: { num: number; home?: { runs?: number }; away?: { runs?: number } }[];
  teams: { home: { runs?: number; hits?: number; errors?: number }; away: { runs?: number; hits?: number; errors?: number } };
}

const str = (v: unknown) => (v == null ? "" : String(v));

export function parseMlb(box: MlbBox, ls: MlbLinescore | null): BoxScore {
  let line: BoxLine | null = null;
  if (ls?.innings.length) {
    // 9회말을 하지 않은 홈팀은 'X'
    const runs = (side: Side) => ls.innings.map((i) => (i[side]?.runs == null ? (side === "home" ? "X" : "-") : String(i[side]!.runs)));
    const total = (side: Side) => [str(ls.teams[side].runs), str(ls.teams[side].hits), str(ls.teams[side].errors)];
    line = {
      labels: [...ls.innings.map((i) => String(i.num)), "R", "H", "E"],
      home: [...runs("home"), ...total("home")],
      away: [...runs("away"), ...total("away")],
    };
  }

  const groups = (t: MlbTeam): BoxGroup[] => {
    const player = (id: number) => t.players[`ID${id}`];
    const batting: BoxGroup = {
      key: "batting",
      labels: ["AB", "R", "H", "RBI", "BB", "SO", "AVG"],
      rows: t.batters
        .map(player)
        .filter((p) => p?.battingOrder && p.stats.batting && Object.keys(p.stats.batting).length > 0)
        .map((p) => {
          const b = p.stats.batting!;
          return {
            name: p.person.fullName,
            pos: p.position?.abbreviation,
            sub: !p.battingOrder!.endsWith("00"),
            stats: [b.atBats, b.runs, b.hits, b.rbi, b.baseOnBalls, b.strikeOuts].map(str).concat(p.seasonStats?.batting?.avg ?? ""),
          };
        }),
      totals: ["atBats", "runs", "hits", "rbi", "baseOnBalls", "strikeOuts"].map((k) => str(t.teamStats.batting[k])).concat(""),
    };
    const pitching: BoxGroup = {
      key: "pitching",
      labels: ["IP", "H", "R", "ER", "BB", "SO", "HR", "ERA"],
      rows: t.pitchers
        .map(player)
        .filter((p) => p?.stats.pitching && Object.keys(p.stats.pitching).length > 0)
        .map((p) => {
          const s = p.stats.pitching!;
          return {
            name: p.person.fullName,
            note: s.note ? String(s.note).replace(/[()]/g, "") : undefined,
            stats: [s.inningsPitched, s.hits, s.runs, s.earnedRuns, s.baseOnBalls, s.strikeOuts, s.homeRuns]
              .map(str)
              .concat(p.seasonStats?.pitching?.era ?? ""),
          };
        }),
      totals: ["inningsPitched", "hits", "runs", "earnedRuns", "baseOnBalls", "strikeOuts", "homeRuns"]
        .map((k) => str(t.teamStats.pitching[k]))
        .concat(""),
    };
    return [batting, pitching].filter((g) => g.rows.length > 0);
  };

  return { source: "mlb", line, stats: [], away: groups(box.teams.away), home: groups(box.teams.home) };
}

/* ---------------- NHL ---------------- */

interface NhlSkater {
  name: { default: string };
  position: string;
  goals?: number;
  assists?: number;
  points?: number;
  plusMinus?: number;
  sog?: number;
  pim?: number;
  toi?: string;
}
interface NhlGoalie {
  name: { default: string };
  shotsAgainst?: number;
  saves?: number;
  savePctg?: number;
  goalsAgainst?: number;
  toi?: string;
  decision?: string;
}
interface NhlTeamPlayers {
  forwards: NhlSkater[];
  defense: NhlSkater[];
  goalies: NhlGoalie[];
}
export interface NhlBox {
  playerByGameStats: { homeTeam: NhlTeamPlayers; awayTeam: NhlTeamPlayers };
}
export interface NhlRail {
  linescore?: {
    byPeriod: { periodDescriptor: { number: number; periodType: string }; home: number; away: number }[];
    totals: { home: number; away: number };
  };
  teamGameStats?: { category: string; homeValue: number | string; awayValue: number | string }[];
}

const NHL_TEAM_STATS: [string, string][] = [
  ["sog", "shots"],
  ["faceoffWins", "faceoffs"],
  ["powerPlay", "powerPlay"],
  ["pim", "pim"],
  ["hits", "hits"],
  ["blockedShots", "blocks"],
];

export function parseNhl(box: NhlBox, rail: NhlRail | null): BoxScore {
  let line: BoxLine | null = null;
  const ls = rail?.linescore;
  if (ls?.byPeriod.length) {
    const label = (p: { number: number; periodType: string }) =>
      p.periodType === "SO" ? "SO" : p.periodType === "OT" ? (p.number > 4 ? `${p.number - 3}OT` : "OT") : String(p.number);
    line = {
      labels: [...ls.byPeriod.map((p) => label(p.periodDescriptor)), "T"],
      home: [...ls.byPeriod.map((p) => String(p.home)), String(ls.totals.home)],
      away: [...ls.byPeriod.map((p) => String(p.away)), String(ls.totals.away)],
    };
  }
  const stats = NHL_TEAM_STATS.flatMap(([category, key]) => {
    const s = rail?.teamGameStats?.find((x) => x.category === category);
    return s ? [{ key, home: String(s.homeValue), away: String(s.awayValue) }] : [];
  });

  const skaters = (key: string, list: NhlSkater[]): BoxGroup => ({
    key,
    labels: ["G", "A", "P", "+/-", "SOG", "PIM", "TOI"],
    rows: list.map((p) => ({
      name: p.name.default,
      pos: p.position,
      stats: [p.goals, p.assists, p.points, p.plusMinus, p.sog, p.pim, p.toi].map(str),
    })),
  });
  const groups = (t: NhlTeamPlayers): BoxGroup[] =>
    [
      skaters("forwards", t.forwards),
      skaters("defense", t.defense),
      {
        key: "goalies",
        labels: ["SA", "SV", "SV%", "GA", "TOI"],
        rows: t.goalies
          .filter((g) => g.toi && g.toi !== "00:00")
          .map((g) => ({
            name: g.name.default,
            note: g.decision,
            stats: [g.shotsAgainst, g.saves, g.savePctg == null ? "" : g.savePctg.toFixed(3).replace(/^0/, ""), g.goalsAgainst, g.toi].map(
              str,
            ),
          })),
      },
    ].filter((g) => g.rows.length > 0);

  return { source: "nhl", line, stats, away: groups(box.playerByGameStats.awayTeam), home: groups(box.playerByGameStats.homeTeam) };
}
