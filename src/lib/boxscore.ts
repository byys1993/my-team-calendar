// 경기 기록지(박스스코어): 출처마다 다른 응답을 화면이 그대로 그릴 수 있는 한 가지 모양으로 바꾼다.
// 화면에서도 쓰므로 DB·서버 코드를 가져오지 않는다 (저장·조회는 lib/boxscoreStore.ts).

// 기록지를 볼 수 있는 대회 (1단계: 미국 4대 리그, 2단계: KBO·유럽 축구·대표팀)
export const SOCCER_BOX_COMPETITIONS = new Set([
  "epl",
  "laliga",
  "bundesliga",
  "serie-a",
  "ligue-1",
  "ucl",
  "uel",
  "uecl",
  "fa-cup",
  "efl-cup",
  "copa-del-rey",
  "dfb-pokal",
  "coppa-italia",
  "coupe-de-france",
  "korea-national",
]);
// 3단계: KBL·K리그·LoL (공식 홈페이지·LoL Esports 데이터)
export const KLEAGUE_BOX_COMPETITIONS = new Set(["k-league-1", "k-league-2"]);
export const LOL_BOX_COMPETITIONS = new Set(["lck", "lol-first-stand", "msi", "worlds"]);
export const BOX_COMPETITIONS = new Set([
  "nba",
  "nfl",
  "mlb",
  "nhl",
  "kbo",
  "kbl",
  ...SOCCER_BOX_COMPETITIONS,
  ...KLEAGUE_BOX_COMPETITIONS,
  ...LOL_BOX_COMPETITIONS,
]);
// 원정팀을 먼저 쓰는 대회 (야구·미국 리그). 나머지는 홈팀(e스포츠는 첫 번째 팀) 먼저.
export const AWAY_FIRST_COMPETITIONS = new Set(["nba", "nfl", "mlb", "nhl", "kbo"]);

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
// 축구 골·카드 (분 단위)
export interface BoxEvent {
  min: string; // "47'" · "90'+3'"
  side: "home" | "away";
  type: "goal" | "pen" | "own" | "yellow" | "red";
  player: string;
  assist?: string;
}
// LoL 세트 하나: 팀 기록과 선수(챔피언·KDA 등)
export interface BoxSet {
  n: number;
  winner: "home" | "away" | null;
  stats: { key: string; away: string; home: string }[];
  home: BoxRow[];
  away: BoxRow[];
}
export interface BoxScore {
  source: "espn" | "mlb" | "nhl" | "kbo" | "kbl" | "kleague" | "lolesports";
  line: BoxLine | null;
  stats: { key: string; away: string; home: string }[]; // key 가 번역 목록에 없으면 그대로(약어) 보인다
  away: BoxGroup[];
  home: BoxGroup[];
  events?: BoxEvent[];
  notes?: { label: string; text: string }[]; // KBO 결승타·홈런·실책 등 (출처 문구 그대로)
  info?: { crowd?: string; duration?: string };
  ref?: string; // 축구: 찾아 둔 ESPN 경기 ID (다시 받을 때 또 찾지 않게)
  sets?: BoxSet[]; // LoL 세트별 기록
}

type Side = "home" | "away";

// 연장 표기: 정규 기간 다음부터 'OT', '2OT' …
const periodLabel = (i: number, regulation: number) => {
  if (i < regulation) return String(i + 1);
  const n = i - regulation + 1;
  return n === 1 ? "OT" : `${n}OT`;
};

/* ---------------- ESPN (NBA·NFL·축구, MLB·NHL 대체) ---------------- */

interface EspnStat {
  name: string;
  displayValue: string;
}
interface EspnRosterPlayer {
  starter?: boolean;
  subbedIn?: boolean;
  athlete: { displayName: string };
  position?: { abbreviation?: string };
  stats?: { name: string; displayValue: string }[];
}
interface EspnKeyEvent {
  type: { type: string };
  text?: string;
  clock?: { displayValue?: string };
  scoringPlay?: boolean;
  shootout?: boolean;
  team?: { id: string };
  participants?: { athlete: { displayName: string } }[];
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
  rosters?: { homeAway: Side; roster?: EspnRosterPlayer[] }[];
  keyEvents?: EspnKeyEvent[];
  gameInfo?: { attendance?: number };
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
  soccer: [
    ["possessionPct", "possessionPct"],
    ["totalShots", "shots"],
    ["shotsOnTarget", "onTarget"],
    ["wonCorners", "corners"],
    ["foulsCommitted", "fouls"],
    ["offsides", "offsides"],
    ["yellowCards", "yellow"],
    ["redCards", "red"],
    ["saves", "saves"],
    ["accuratePasses", "passes"],
  ],
};
// 축구 선수 기록: 골·도움·슈팅·유효 슈팅·파울·경고·퇴장
const SOCCER_PLAYER_STATS: [string, string][] = [
  ["totalGoals", "G"],
  ["goalAssists", "A"],
  ["totalShots", "SH"],
  ["shotsOnTarget", "SOG"],
  ["foulsCommitted", "FC"],
  ["yellowCards", "YC"],
  ["redCards", "RC"],
];
const REGULATION: Record<string, number> = { basketball: 4, football: 4, hockey: 3, baseball: 9 };

// path 는 'basketball/nba' 같은 ESPN 경로
export function parseEspn(json: EspnSummary, path: string): BoxScore {
  const sport = path.split("/")[0];
  const competitors = json.header.competitions[0]?.competitors ?? [];
  const sideOf = new Map(competitors.map((c) => [c.id, c.homeAway]));
  const bySide = (side: Side) => competitors.find((c) => c.homeAway === side);

  let line: BoxLine | null = null; // 축구는 전·후반 점수 대신 골 기록(events)을 보여 준다
  const home = bySide("home");
  const away = bySide("away");
  if (sport !== "soccer" && home?.linescores?.length && away?.linescores?.length) {
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
    if (h != null && a != null) stats.push(key === "possessionPct" ? { key, home: `${h}%`, away: `${a}%` } : { key, home: h, away: a });
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

  if (sport === "soccer") return { source: "espn", line: null, stats, ...soccerPlayers(json, sideOf) };
  return { source: "espn", line, stats, away: groups("away"), home: groups("home") };
}

// 축구: 출전 선수(선발 + 교체로 들어온 선수)와 골·카드
function soccerPlayers(json: EspnSummary, sideOf: Map<string, Side>): Pick<BoxScore, "away" | "home" | "events" | "info"> {
  const lineup = (side: Side): BoxGroup[] => {
    const roster = json.rosters?.find((r) => r.homeAway === side)?.roster ?? [];
    const rows = roster
      .filter((p) => p.starter || p.subbedIn)
      .map((p) => ({
        name: p.athlete.displayName,
        pos: p.starter ? p.position?.abbreviation : undefined,
        sub: !p.starter,
        stats: SOCCER_PLAYER_STATS.map(([name]) => p.stats?.find((s) => s.name === name)?.displayValue ?? ""),
      }));
    return rows.length ? [{ key: "lineup", labels: SOCCER_PLAYER_STATS.map(([, l]) => l), rows }] : [];
  };
  const events: BoxEvent[] = [];
  for (const e of json.keyEvents ?? []) {
    const side = e.team && sideOf.get(e.team.id);
    const who = e.participants?.[0]?.athlete.displayName;
    if (!side || !who || e.shootout) continue;
    const t = e.type.type;
    const type: BoxEvent["type"] | null = e.scoringPlay
      ? /own/i.test(t) || /own goal/i.test(e.text ?? "")
        ? "own"
        : /penalty/i.test(t)
          ? "pen"
          : "goal"
      : t === "yellow-card"
        ? "yellow"
        : t === "red-card" || t === "yellow-red-card"
          ? "red"
          : null;
    if (!type) continue;
    const assist = type === "goal" ? e.participants?.[1]?.athlete.displayName : undefined;
    events.push({ min: e.clock?.displayValue ?? "", side, type, player: who, ...(assist ? { assist } : {}) });
  }
  const crowd = json.gameInfo?.attendance;
  return { away: lineup("away"), home: lineup("home"), events, ...(crowd ? { info: { crowd: crowd.toLocaleString("en-US") } } : {}) };
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

/* ---------------- KBO (공식 경기센터 화면용 표 데이터) ---------------- */

interface KboCell {
  Text: string;
}
interface KboTable {
  headers?: { row: KboCell[] }[];
  rows?: { row: KboCell[] }[];
  tfoot?: { row: KboCell[] }[];
}
// 표는 JSON 문자열 안에 또 JSON 문자열로 온다. 순서는 [원정, 홈].
export interface KboBox {
  tableEtc?: string;
  arrHitter?: { table1: string; table2: string; table3: string }[];
  arrPitcher?: { table: string }[];
}
export interface KboBoard {
  CROWD_CN?: string;
  USE_TM?: string;
  table2?: string; // 이닝별 점수 [원정, 홈]
  table3?: string; // R H E B
}

const kboText = (c: KboCell | undefined) =>
  (c?.Text ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
const kboTable = (s: string | undefined): KboTable => (s ? (JSON.parse(s) as KboTable) : {});
const kboRows = (rows: KboTable["rows"]) => (rows ?? []).map((r) => r.row.map(kboText));

export function parseKbo(box: KboBox, board: KboBoard | null): BoxScore {
  let line: BoxLine | null = null;
  const innings = kboRows(kboTable(board?.table2).rows);
  const rhe = kboRows(kboTable(board?.table3).rows);
  if (innings.length === 2) {
    // 15회까지 칸이 있으므로 실제로 한 이닝까지만 (최소 9회). 9회말을 하지 않은 홈팀은 'X'
    const played = Math.max(9, ...innings.map((r) => r.findLastIndex((v) => v !== "-" && v !== "") + 1));
    const runs = (r: string[], home: boolean) => r.slice(0, played).map((v) => (v === "-" || v === "" ? (home ? "X" : "-") : v));
    line = {
      labels: [...Array.from({ length: played }, (_, i) => String(i + 1)), "R", "H", "E"],
      away: [...runs(innings[0], false), ...(rhe[0] ?? []).slice(0, 3)],
      home: [...runs(innings[1], true), ...(rhe[1] ?? []).slice(0, 3)],
    };
  }

  const notes = kboRows(kboTable(box.tableEtc).rows)
    .filter((r) => r.length >= 2 && r[1])
    .map(([label, text]) => ({ label, text }));

  const groups = (i: number): BoxGroup[] => {
    const out: BoxGroup[] = [];
    const h = box.arrHitter?.[i];
    if (h) {
      const who = kboRows(kboTable(h.table1).rows); // [타순, 포지션, 이름]
      const plays = kboTable(h.table2);
      const stats = kboTable(h.table3); // [타수, 안타, 타점, 득점, 타율]
      const statRows = kboRows(stats.rows);
      const rows = who.map(([order, pos, name], j) => ({
        name,
        pos,
        sub: j > 0 && who[j - 1][0] === order, // 같은 타순이 이어지면 교체 선수
        stats: statRows[j] ?? [],
      }));
      out.push({ key: "batting", labels: ["AB", "H", "RBI", "R", "AVG"], rows, totals: kboRows(stats.tfoot)[0] });
      // 타석 결과 ('좌비', '1안' …): 이닝별
      const playRows = kboRows(plays.rows);
      out.push({
        key: "plays",
        labels: kboRows(plays.headers)[0] ?? [],
        rows: rows.map((r, j) => ({ name: r.name, sub: r.sub, stats: playRows[j] ?? [] })),
      });
    }
    const p = box.arrPitcher?.[i];
    if (p) {
      const t = kboTable(p.table);
      const head = kboRows(t.headers)[0] ?? [];
      const col = (name: string) => head.indexOf(name);
      const cols = ["이닝", "피안타", "실점", "자책", "4사구", "삼진", "홈런", "투구수", "평균자책점"].map(col);
      const rows = kboRows(t.rows).map((r) => ({
        name: r[col("선수명")],
        note: r[col("결과")] || undefined,
        stats: cols.map((c) => (c < 0 ? "" : r[c])),
      }));
      // 합계 줄은 'TOTAL' 한 칸 뒤로 '이닝'부터 이어진다
      const foot = kboRows(t.tfoot)[0];
      const shift = col("이닝") - 1;
      out.push({
        key: "pitching",
        labels: ["IP", "H", "R", "ER", "BB", "SO", "HR", "NP", "ERA"],
        rows,
        totals: foot ? cols.map((c) => (c < 0 ? "" : (foot[c - shift] ?? ""))) : undefined,
      });
    }
    return out.filter((g) => g.rows.length > 0);
  };

  const info = { crowd: board?.CROWD_CN || undefined, duration: board?.USE_TM || undefined };
  return { source: "kbo", line, stats: [], away: groups(0), home: groups(1), notes, info };
}
