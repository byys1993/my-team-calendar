// 3단계 기록지: KBL·K리그·V-리그(공식 홈페이지 데이터)와 LoL(LoL Esports 데이터). 모양은 lib/boxscore.ts 와 같다.
import type { BoxEvent, BoxGroup, BoxRow, BoxScore, BoxSet } from "@/lib/boxscore";

type Side = "home" | "away";
const str = (v: unknown) => (v == null ? "" : String(v));

/* ---------------- KBL ---------------- */

interface KblQuarters {
  scoreq1?: number;
  scoreq2?: number;
  scoreq3?: number;
  scoreq4?: number;
  scoreeq?: unknown[]; // 연장 쿼터 점수 (연장이 없으면 빈 배열)
}
export interface KblMatch {
  game: { tcodeH: string; tcodeA: string; crowds?: number | null; gameTime?: number | string | null };
  teamrecords?: { home?: KblQuarters; away?: KblQuarters };
}
interface KblRecords {
  playMin?: number;
  playSec?: number;
  score?: number;
  fgt?: number; // 야투 (2점 + 3점)
  fgtA?: number;
  threep?: number;
  threepA?: number;
  ft?: number;
  ftA?: number;
  rb?: number;
  ast?: number;
  stl?: number;
  bs?: number;
  to?: number;
  foul?: number;
  fbScoreCn?: number; // 속공 득점
  benchScoreCn?: number; // 벤치 득점
}
export interface KblPlayerStat {
  player: { pname: string; pos?: string };
  records: KblRecords;
  homeAway: string; // '1' 홈, '2' 원정
  startFlag: number; // 1 선발
}
export interface KblTeamRecord {
  tcode: string;
  records: KblRecords;
}

// 연장 쿼터 점수는 숫자이거나 숫자가 든 객체
const otScore = (v: unknown): string => {
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object") {
    const n = Object.values(v).find((x) => typeof x === "number");
    if (n != null) return String(n);
  }
  return "-";
};
const made = (a?: number, b?: number) => `${a ?? 0}-${b ?? 0}`;
const pct = (a?: number, b?: number) => (b ? String(Math.round(((a ?? 0) / b) * 100)) : "0");

const KBL_LABELS = ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "STL", "BLK", "TO", "PF"];
const kblLine = (r: KblRecords) => [
  str(r.score),
  made(r.fgt, r.fgtA),
  made(r.threep, r.threepA),
  made(r.ft, r.ftA),
  str(r.rb),
  str(r.ast),
  str(r.stl),
  str(r.bs),
  str(r.to),
  str(r.foul),
];

export function parseKbl(match: KblMatch, players: KblPlayerStat[], teams: KblTeamRecord[]): BoxScore {
  let line: BoxScore["line"] = null;
  const q = match.teamrecords;
  if (q?.home && q.away) {
    const quarters = (t: KblQuarters) => [t.scoreq1, t.scoreq2, t.scoreq3, t.scoreq4].map(str).concat((t.scoreeq ?? []).map(otScore));
    const h = quarters(q.home);
    const a = quarters(q.away);
    const sum = (xs: string[]) => String(xs.reduce((s, x) => s + (Number(x) || 0), 0));
    line = {
      labels: [...h.map((_, i) => (i < 4 ? String(i + 1) : i === 4 ? "OT" : `${i - 3}OT`)), "T"],
      home: [...h, sum(h)],
      away: [...a, sum(a)],
    };
  }

  const team = (side: Side) => teams.find((t) => t.tcode === (side === "home" ? match.game.tcodeH : match.game.tcodeA))?.records;
  const stats: BoxScore["stats"] = [];
  const h = team("home");
  const a = team("away");
  if (h && a) {
    const add = (key: string, f: (r: KblRecords) => string) => stats.push({ key, home: f(h), away: f(a) });
    add("FG", (r) => made(r.fgt, r.fgtA));
    add("FG%", (r) => pct(r.fgt, r.fgtA));
    add("3PT", (r) => made(r.threep, r.threepA));
    add("FT", (r) => made(r.ft, r.ftA));
    add("REB", (r) => str(r.rb));
    add("AST", (r) => str(r.ast));
    add("STL", (r) => str(r.stl));
    add("BLK", (r) => str(r.bs));
    add("TO", (r) => str(r.to));
    add("fastBreak", (r) => str(r.fbScoreCn));
    add("bench", (r) => str(r.benchScoreCn));
  }

  const groups = (side: Side): BoxGroup[] => {
    const rows = players
      .filter((p) => (p.homeAway === "1") === (side === "home") && ((p.records.playMin ?? 0) > 0 || (p.records.playSec ?? 0) > 0))
      .sort((x, y) => y.startFlag - x.startFlag)
      .map((p) => ({
        name: p.player.pname,
        pos: p.player.pos,
        sub: p.startFlag !== 1,
        stats: [`${p.records.playMin ?? 0}:${String(p.records.playSec ?? 0).padStart(2, "0")}`, ...kblLine(p.records)],
      }));
    const t = team(side);
    return rows.length ? [{ key: "players", labels: KBL_LABELS, rows, totals: t ? ["", ...kblLine(t)] : undefined }] : [];
  };

  // 경기 시간은 '150' = 1시간 50분
  const time = match.game.gameTime == null ? "" : String(match.game.gameTime).padStart(4, "0");
  const info = {
    crowd: match.game.crowds ? match.game.crowds.toLocaleString("en-US") : undefined,
    duration: time ? `${Number(time.slice(0, 2))}:${time.slice(2)}` : undefined,
  };
  return { source: "kbl", line, stats, away: groups("away"), home: groups("home"), info };
}

/* ---------------- V-리그 ---------------- */

type SetNo = 1 | 2 | 3 | 4 | 5;
export type KovoGameDetail = { hcode: string; acode: string; spectators?: number | null; sptime?: string | null } & Partial<
  Record<`hs${SetNo}point` | `as${SetNo}point`, number | null>
>;
interface KovoRecords {
  tcode: string;
  point?: number; // 팀 기록은 상대 범실로 얻은 점수까지 포함 (경기 총득점과 같다)
  att?: number; // 공격 시도
  ats?: number; // 공격 성공
  atsp?: number; // 공격 성공률
  ss?: number; // 서브 득점
  bs?: number; // 블로킹 득점
  ds?: number; // 디그 성공
  sets?: number; // 세트 성공
  rt?: number; // 리시브 시도
  rsp?: number; // 리시브 효율
  err?: number; // 범실
}
export interface KovoPlayer extends KovoRecords {
  pname: string;
  position?: string;
  // 세트별 출전: '-1' 선발, '-2' 뛰지 않음, 그 밖의 값은 교체로 들어온 경우
  ynS1?: string;
  ynS2?: string;
  ynS3?: string;
  ynS4?: string;
  ynS5?: string;
}
export interface KovoDetail {
  game: KovoGameDetail;
  player: KovoPlayer[];
  team: KovoRecords[];
}

const KOVO_LABELS = ["PTS", "ATK", "ATK%", "ACE", "BLK", "DIG", "SET", "RCV%", "ERR"];
const SET_NUMBERS: SetNo[] = [1, 2, 3, 4, 5];
const rate = (v?: number) => String(Math.round((v ?? 0) * 10) / 10);
const kovoLine = (r: KovoRecords) => [
  str(r.point),
  made(r.ats, r.att),
  r.att ? rate(r.atsp) : "-",
  str(r.ss),
  str(r.bs),
  str(r.ds),
  str(r.sets),
  r.rt ? rate(r.rsp) : "-",
  str(r.err),
];

export function parseKovo({ game, player, team }: KovoDetail): BoxScore {
  // 치르지 않은 세트는 0 : 0 으로 온다
  const played = SET_NUMBERS.filter((n) => (game[`hs${n}point`] ?? 0) + (game[`as${n}point`] ?? 0) > 0);
  const points = (side: "hs" | "as") => played.map((n) => game[`${side}${n}point`] ?? 0);
  const sum = (xs: number[]) => String(xs.reduce((s, x) => s + x, 0));
  const line: BoxScore["line"] = played.length
    ? {
        labels: [...played.map(String), "T"],
        home: [...points("hs").map(String), sum(points("hs"))],
        away: [...points("as").map(String), sum(points("as"))],
      }
    : null;

  const code = { home: game.hcode, away: game.acode };
  const records = (side: Side) => team.find((t) => t.tcode === code[side]);
  const stats: BoxScore["stats"] = [];
  const h = records("home");
  const a = records("away");
  if (h && a) {
    const add = (key: string, f: (r: KovoRecords) => string) => stats.push({ key, home: f(h), away: f(a) });
    add("vbAttackPct", (r) => `${rate(r.atsp)}%`);
    add("vbAttack", (r) => made(r.ats, r.att));
    add("vbBlocks", (r) => str(r.bs));
    add("vbAces", (r) => str(r.ss));
    add("vbDigs", (r) => str(r.ds));
    add("vbSets", (r) => str(r.sets));
    add("vbReceivePct", (r) => `${rate(r.rsp)}%`);
    add("vbErrors", (r) => str(r.err));
  }

  const groups = (side: Side): BoxGroup[] => {
    const inSets = (p: KovoPlayer) => [p.ynS1, p.ynS2, p.ynS3, p.ynS4, p.ynS5];
    const rows = player
      .filter((p) => p.tcode === code[side] && inSets(p).some((s) => s != null && s !== "-2"))
      .map((p) => ({ p, starter: inSets(p).includes("-1") }))
      .sort((x, y) => Number(y.starter) - Number(x.starter))
      .map(({ p, starter }) => ({ name: p.pname, pos: p.position, sub: !starter, stats: kovoLine(p) }));
    const t = records(side);
    return rows.length ? [{ key: "players", labels: KOVO_LABELS, rows, totals: t ? kovoLine(t) : undefined }] : [];
  };

  const info = {
    crowd: game.spectators ? game.spectators.toLocaleString("en-US") : undefined,
    duration: game.sptime ? game.sptime.replace(/^0/, "") : undefined, // '01:23'
  };
  return { source: "kovo", line, stats, away: groups("away"), home: groups("home"), info };
}

/* ---------------- K리그 ---------------- */

interface KleagueEvent {
  eventName: string; // '득점' '도움' '경고' '퇴장' '교체' …
  halfType: number; // 1 전반, 2 후반, 3·4 연장
  timeMin: number; // 그 하프 안의 분
  homeOrAway: "HOME" | "AWAY" | string;
  playerName: string;
}
export interface KleagueInfo {
  firstHalf?: KleagueEvent[];
  secondHalf?: KleagueEvent[];
  EfirstHalf?: KleagueEvent[];
  EsecondHalf?: KleagueEvent[];
  homeScorer?: { name: string; isOwnGoal: boolean; time: number }[];
  awayScorer?: { name: string; isOwnGoal: boolean; time: number }[];
}
type KleagueTeamRecord = Partial<
  Record<
    "possession" | "attempts" | "onTarget" | "corners" | "fouls" | "offsides" | "yellowCards" | "redCards" | "doubleYellowCards",
    number
  >
>;
export interface KleagueRecord {
  home?: KleagueTeamRecord;
  away?: KleagueTeamRecord;
}

// 하프 안의 분 → 경기 분 ('45'+2'' 처럼 추가 시간 표시)
const HALF_BASE = [0, 0, 45, 90, 105];
const HALF_END = [0, 45, 90, 105, 120];
export function kleagueMinute(half: number, min: number): string {
  const m = (HALF_BASE[half] ?? 0) + min;
  const end = HALF_END[half] ?? 90;
  return m > end ? `${end}'+${m - end}'` : `${Math.max(m, 1)}'`;
}

// 경기 화면 HTML 의 출전 명단 표: <tr onclick="playerDetailPop('K09', '2020…')"><td>배번</td><td>포지션</td><td>이름</td>…
// 뒤에 오는 playerIco('home'|'away', '기록', id, 'gk'|'df'|…|'bc'(벤치)) 와 changeM_{id}(교체 시각)로 선발·교체를 가린다.
export function parseKleagueLineup(html: string): { home: KleagueLineupPlayer[]; away: KleagueLineupPlayer[] } {
  const out = { home: [] as KleagueLineupPlayer[], away: [] as KleagueLineupPlayer[] };
  const seen = new Set<string>();
  const row = /playerDetailPop\('[^']*',\s*'(\d+)'\)">\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>/g;
  for (const m of html.matchAll(row)) {
    const [, id, , pos, rawName] = m;
    if (seen.has(id)) continue;
    const ico = html.slice(m.index).match(new RegExp(`playerIco\\('(home|away)',\\s*'[^']*',\\s*'${id}',\\s*'([a-z]*)'`));
    if (!ico) continue;
    seen.add(id);
    const changed = html.match(new RegExp(`changeM_${id}">([^<]*)<`))?.[1]?.trim();
    const bench = ico[2] === "bc";
    if (bench && !changed) continue; // 뛰지 않은 교체 선수
    out[ico[1] as Side].push({ name: rawName.replace(/\(c\)$/, "").trim(), pos: pos.trim(), sub: bench });
  }
  return out;
}
interface KleagueLineupPlayer {
  name: string;
  pos: string;
  sub: boolean;
}

export function parseKleague(
  info: KleagueInfo,
  record: KleagueRecord | null,
  lineup: ReturnType<typeof parseKleagueLineup> | null,
): BoxScore {
  const all = [...(info.firstHalf ?? []), ...(info.secondHalf ?? []), ...(info.EfirstHalf ?? []), ...(info.EsecondHalf ?? [])];
  const own = new Set([...(info.homeScorer ?? []), ...(info.awayScorer ?? [])].filter((s) => s.isOwnGoal).map((s) => s.name));
  const events: BoxEvent[] = [];
  for (const [i, e] of all.entries()) {
    const side: Side | null = e.homeOrAway === "HOME" ? "home" : e.homeOrAway === "AWAY" ? "away" : null;
    if (!side || !e.playerName) continue;
    const min = kleagueMinute(e.halfType, e.timeMin);
    if (/득점|골/.test(e.eventName) && !/도움/.test(e.eventName)) {
      // 도움은 바로 뒤에 같은 팀·같은 시각의 '도움' 이벤트로 온다
      const next = all[i + 1];
      const assist =
        next && /도움/.test(next.eventName) && next.homeOrAway === e.homeOrAway && next.timeMin === e.timeMin ? next.playerName : undefined;
      const type: BoxEvent["type"] =
        /자책/.test(e.eventName) || own.has(e.playerName) ? "own" : /PK|페널티/i.test(e.eventName) ? "pen" : "goal";
      // 자책골은 상대 팀 득점으로 올라온다 (기록된 팀 그대로 표시)
      events.push({ min, side, type, player: e.playerName, ...(assist && type === "goal" ? { assist } : {}) });
    } else if (/퇴장/.test(e.eventName)) {
      events.push({ min, side, type: "red", player: e.playerName });
    } else if (e.eventName === "경고") {
      events.push({ min, side, type: "yellow", player: e.playerName });
    }
  }

  const stats: BoxScore["stats"] = [];
  const h = record?.home;
  const a = record?.away;
  if (h && a) {
    const add = (key: string, f: (r: KleagueTeamRecord) => string) => stats.push({ key, home: f(h), away: f(a) });
    add("possessionPct", (r) => `${r.possession ?? 0}%`);
    add("shots", (r) => str(r.attempts));
    add("onTarget", (r) => str(r.onTarget));
    add("corners", (r) => str(r.corners));
    add("fouls", (r) => str(r.fouls));
    add("offsides", (r) => str(r.offsides));
    add("yellow", (r) => str(r.yellowCards));
    add("red", (r) => str((r.redCards ?? 0) + (r.doubleYellowCards ?? 0)));
  }

  // 출전 선수: 골·도움·경고·퇴장은 골·카드 기록에서 센다
  const count = (name: string, side: Side, f: (e: BoxEvent) => boolean) =>
    String(events.filter((e) => e.side === side && f(e) && e.player === name).length);
  const assists = (name: string, side: Side) => String(events.filter((e) => e.side === side && e.assist === name).length);
  const groups = (side: Side): BoxGroup[] => {
    const list = lineup?.[side] ?? [];
    if (!list.length) return [];
    const rows: BoxRow[] = list.map((p) => ({
      name: p.name,
      pos: p.sub ? undefined : p.pos,
      sub: p.sub,
      stats: [
        count(p.name, side, (e) => e.type === "goal" || e.type === "pen"),
        assists(p.name, side),
        count(p.name, side, (e) => e.type === "yellow"),
        count(p.name, side, (e) => e.type === "red"),
      ],
    }));
    return [{ key: "lineup", labels: ["G", "A", "YC", "RC"], rows }];
  };

  return { source: "kleague", line: null, stats, away: groups("away"), home: groups("home"), events };
}

/* ---------------- LoL (LoL Esports) ---------------- */

export interface LolEventDetails {
  match: {
    teams: { id: string; code: string; result?: { gameWins: number } | null }[]; // [첫 번째 팀(우리 '홈'), 두 번째 팀]
    games: { number: number; id: string; state: string; teams: { id: string; side: "blue" | "red" }[] }[];
  };
}
interface LolTeamFrame {
  totalGold: number;
  inhibitors: number;
  towers: number;
  barons: number;
  totalKills: number;
  dragons: string[];
  participants: {
    participantId: number;
    totalGold: number;
    level: number;
    kills: number;
    deaths: number;
    assists: number;
    creepScore: number;
  }[];
}
interface LolTeamMeta {
  esportsTeamId: string;
  participantMetadata: { participantId: number; summonerName: string; championId: string; role: string }[];
}
export interface LolWindow {
  gameMetadata: { blueTeamMetadata: LolTeamMeta; redTeamMetadata: LolTeamMeta };
  frames: ({ gameState: string; blueTeam: LolTeamFrame; redTeam: LolTeamFrame } & Record<string, unknown>)[];
}

const ROLE: Record<string, string> = { top: "TOP", jungle: "JGL", mid: "MID", bottom: "BOT", support: "SUP" };
const gold = (n: number) => `${(n / 1000).toFixed(1)}k`;

// windows: 세트 번호 → 그 세트 마지막 화면 (끝난 세트만)
export function parseLol(details: LolEventDetails, windows: Map<number, LolWindow>): BoxScore {
  const homeId = details.match.teams[0]?.id;
  const sets: BoxSet[] = [];
  for (const g of details.match.games) {
    const w = windows.get(g.number);
    const last = w?.frames.at(-1);
    if (!w || !last) continue;
    const blueIsHome = w.gameMetadata.blueTeamMetadata.esportsTeamId === homeId;
    const of = (side: Side) => {
      const blue = (side === "home") === blueIsHome;
      return { frame: blue ? last.blueTeam : last.redTeam, meta: blue ? w.gameMetadata.blueTeamMetadata : w.gameMetadata.redTeamMetadata };
    };
    const h = of("home");
    const a = of("away");
    // 최종 화면에 승자 표시가 없어, 억제기 → 타워 순으로 더 많이 부순 팀을 승자로 본다
    const score = (t: LolTeamFrame) => t.inhibitors * 100 + t.towers;
    const winner: Side | null =
      last.gameState === "finished" && score(h.frame) !== score(a.frame) ? (score(h.frame) > score(a.frame) ? "home" : "away") : null;
    const stat = (key: string, f: (t: LolTeamFrame) => string) => ({ key, home: f(h.frame), away: f(a.frame) });
    const rows = (t: { frame: LolTeamFrame; meta: LolTeamMeta }): BoxRow[] =>
      t.meta.participantMetadata.map((p) => {
        const s = t.frame.participants.find((x) => x.participantId === p.participantId);
        return {
          name: p.summonerName.replace(/^\S+\s+/, ""), // 'GEN Chovy' → 'Chovy'
          pos: ROLE[p.role] ?? p.role,
          note: p.championId,
          stats: s ? [s.kills, s.deaths, s.assists, s.creepScore, gold(s.totalGold), s.level].map(String) : [],
        };
      });
    sets.push({
      n: g.number,
      winner,
      stats: [
        stat("kills", (t) => String(t.totalKills)),
        stat("gold", (t) => gold(t.totalGold)),
        stat("towers", (t) => String(t.towers)),
        stat("inhibitors", (t) => String(t.inhibitors)),
        stat("dragons", (t) => String(t.dragons.length)),
        stat("barons", (t) => String(t.barons)),
      ],
      home: rows(h),
      away: rows(a),
    });
  }
  // 세트 승패 줄: 승자를 모두 알 수 있고 공식 세트 스코어와 맞을 때만 (아니면 세트별 승자 표시도 지운다)
  const wins = (side: Side) => sets.filter((s) => s.winner === side).length;
  const [t1, t2] = details.match.teams;
  const known =
    sets.length > 0 &&
    sets.every((s) => s.winner) &&
    (t1?.result?.gameWins == null || (wins("home") === t1.result.gameWins && wins("away") === t2?.result?.gameWins));
  if (!known) for (const s of sets) s.winner = null;
  const line = known
    ? {
        labels: [...sets.map((s) => String(s.n)), "T"],
        home: [...sets.map((s) => (s.winner === "home" ? "W" : "L")), String(wins("home"))],
        away: [...sets.map((s) => (s.winner === "away" ? "W" : "L")), String(wins("away"))],
      }
    : null;
  return { source: "lolesports", line, stats: [], away: [], home: [], sets };
}

export const LOL_PLAYER_LABELS = ["K", "D", "A", "CS", "G", "Lv"];
