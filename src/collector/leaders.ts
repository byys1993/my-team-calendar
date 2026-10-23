import { TEAM_CODE as KBO_TEAM_CODE } from "./sources/kbo";
import { getJson, request, sleep, SourceError } from "./sources/http";
import type { StandingRowIn, StandingTableIn } from "./standings";
import type { Fetcher } from "./types";

// 개인 순위 TOP 5. 대회마다 시상 부문 위주로 고른 부문(그룹)별 상위 5명을 순위표와 같은 모양(kind 'leaders')으로 만든다.
// 그룹 이름은 부문 키('hr', 'goals' …)이고 화면이 그 언어 이름으로 바꾼다. 값(stats.value)은 출처 표기를 다듬은 문자열.

const TOP = 5;

type Row = StandingRowIn;
const group = (key: string, rows: Row[]) => ({ name: key, rows: rows.slice(0, TOP) });

// 값이 같으면 같은 순위 (1, 1, 3 …)
function ranked<T>(items: T[], value: (x: T) => number, toRow: (x: T, rank: number) => Row): Row[] {
  const rows: Row[] = [];
  items.forEach((x, i) => {
    const prev = i > 0 ? value(items[i - 1]) : null;
    const rank = prev !== null && prev === value(x) ? rows[i - 1].rank : i + 1;
    rows.push(toRow(x, rank));
  });
  return rows;
}

const fixed = (v: unknown, digits: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : String(v ?? "");
};
// .316 처럼 0 을 뗀 비율 (야구 타율 등)
const rate = (v: unknown) => {
  const s = fixed(v, 3);
  return s.startsWith("0.") ? s.slice(1) : s;
};

// --- KBO 공식 홈페이지 'TOP5' 화면 (HTML)
const KBO_CATEGORIES: [string, string][] = [
  ["타율", "avg"],
  ["홈런", "hr"],
  ["타점", "rbi"],
  ["득점", "runs"],
  ["안타", "hits"],
  ["도루", "sb"],
  ["출루율", "obp"],
  ["장타율", "slg"],
  ["평균자책점", "era"],
  ["승리", "wins"],
  ["탈삼진", "so"],
  ["세이브", "sv"],
  ["홀드", "hld"],
];
export function parseKboLeaders(html: string): StandingTableIn {
  const groups: StandingTableIn["groups"] = [];
  for (const [title, key] of KBO_CATEGORIES) {
    const at = html.indexOf(`<span class="title">${title} TOP5</span>`);
    if (at < 0) continue;
    const list = html.slice(at, html.indexOf("</ol>", at));
    const rows: Row[] = [];
    for (const li of list.match(/<li>[\s\S]*?<\/li>/g) ?? []) {
      const rank = Number(li.match(/rank(\d+)/)?.[1]);
      const name = li.match(/<a[^>]*>([^<]+)<\/a>/)?.[1]?.trim();
      const team = li.match(/<span class="team">([^<]+)<\/span>/)?.[1]?.trim() ?? "";
      const value = li.match(/<span class="rr">([^<]+)<\/span>/)?.[1]?.trim();
      if (!rank || !name || !value) continue;
      rows.push({
        rank,
        name,
        ref: { source: "kbo", externalId: KBO_TEAM_CODE[team] ?? null, name: team },
        sub: team,
        stats: { value: ["avg", "obp", "slg"].includes(key) ? rate(value) : value },
      });
    }
    if (rows.length) groups.push(group(key, rows));
  }
  if (groups.length === 0) throw new SourceError("KBO TOP5 형식이 바뀌었습니다");
  return { kind: "leaders", season: null, groups };
}

// --- KBL 시즌 리더 (api.kbl.or.kr)
interface KblLeaderPart {
  part: string;
  list: { rank: number; value: number; player: { pname: string; tcode: string; tname: string } }[];
}
const KBL_PARTS: [string, string][] = [
  ["score", "ppg"],
  ["rb", "rpg"],
  ["ast", "apg"],
  ["stl", "spg"],
  ["bs", "bpg"],
  ["threep", "tpm"],
];
export function parseKblLeaders(parts: KblLeaderPart[]): StandingTableIn {
  const byPart = new Map(parts.map((p) => [p.part, p]));
  const groups = KBL_PARTS.flatMap(([part, key]) => {
    const p = byPart.get(part);
    if (!p?.list.length) return [];
    return [
      group(
        key,
        p.list.map((x) => ({
          rank: x.rank,
          name: x.player.pname,
          ref: { source: "kbl", externalId: x.player.tcode, name: x.player.tname },
          sub: x.player.tname,
          stats: { value: fixed(x.value, 1) },
        })),
      ),
    ];
  });
  return { kind: "leaders", season: null, groups };
}

// --- K리그 득점·도움 (kleague.com)
interface KleaguePlayer {
  rank: number;
  name: string;
  teamId: string;
  teamName: string;
  goalQty: number;
  assistQty: number;
}
export function parseKleagueLeaders(goals: KleaguePlayer[], assists: KleaguePlayer[]): StandingTableIn {
  const rows = (list: KleaguePlayer[], field: "goalQty" | "assistQty") =>
    list.map((x) => ({
      rank: x.rank,
      name: x.name,
      ref: { source: "kleague", externalId: x.teamId, name: x.teamName },
      sub: x.teamName,
      stats: { value: String(x[field]) },
    }));
  return {
    kind: "leaders",
    season: null,
    groups: [group("goals", rows(goals, "goalQty")), group("assists", rows(assists, "assistQty"))].filter((g) => g.rows.length),
  };
}

// --- football-data 득점 순위 (유럽 리그·UCL)
interface FdScorers {
  season?: { startDate?: string };
  scorers: { player: { name: string }; team: { id: number; name: string; shortName?: string }; goals: number }[];
}
export function parseFootballDataScorers(json: FdScorers): StandingTableIn {
  const sorted = [...json.scorers].sort((a, b) => b.goals - a.goals);
  return {
    kind: "leaders",
    season: json.season?.startDate?.slice(0, 4) ?? null,
    groups: [
      group(
        "goals",
        ranked(
          sorted,
          (x) => x.goals,
          (x, rank) => ({
            rank,
            name: x.player.name,
            ref: { source: "football-data", externalId: String(x.team.id), name: x.team.name },
            sub: x.team.shortName ?? x.team.name,
            stats: { value: String(x.goals) },
          }),
        ),
      ),
    ],
  };
}

// --- ESPN (NBA·NFL)
interface EspnLeaders {
  leaders?: {
    categories: {
      name: string;
      leaders: { displayValue: string; value?: number; athlete: { displayName: string; team?: { id: string; abbreviation?: string } }; team?: { id: string; abbreviation?: string } }[];
    }[];
  };
}
const ESPN_CATEGORIES: Record<string, [string, string][]> = {
  "basketball/nba": [
    ["pointsPerGame", "ppg"],
    ["reboundsPerGame", "rpg"],
    ["assistsPerGame", "apg"],
    ["stealsPerGame", "spg"],
    ["blocksPerGame", "bpg"],
    ["3PointsMadePerGame", "tpm"],
  ],
  "football/nfl": [
    ["passingYards", "passYds"],
    ["passingTouchdowns", "passTd"],
    ["rushingYards", "rushYds"],
    ["receivingYards", "recYds"],
    ["sacks", "sacks"],
    ["interceptions", "int"],
  ],
};
export function parseEspnLeaders(json: EspnLeaders, path: string): StandingTableIn {
  const league = path.split("/")[1];
  const byName = new Map((json.leaders?.categories ?? []).map((c) => [c.name, c]));
  const groups = (ESPN_CATEGORIES[path] ?? []).flatMap(([name, key]) => {
    const c = byName.get(name);
    if (!c?.leaders.length) return [];
    const list = c.leaders.slice(0, TOP);
    return [
      group(
        key,
        ranked(
          list,
          (x) => x.value ?? Number(x.displayValue),
          (x, rank) => {
            const team = x.athlete.team ?? x.team;
            return {
              rank,
              name: x.athlete.displayName,
              ref: { source: "espn", externalId: team ? `${league}:${team.id}` : null, name: team?.abbreviation ?? "" },
              sub: team?.abbreviation,
              stats: { value: x.displayValue },
            };
          },
        ),
      ),
    ];
  });
  return { kind: "leaders", season: null, groups };
}

// --- MLB Stats API
interface MlbLeaders {
  leagueLeaders: {
    leaderCategory: string;
    leaders: { rank: number; value: string; person: { fullName: string }; team?: { id: number; name: string } }[];
  }[];
}
const MLB_HITTING: [string, string][] = [
  ["battingAverage", "avg"],
  ["homeRuns", "hr"],
  ["runsBattedIn", "rbi"],
  ["hits", "hits"],
  ["stolenBases", "sb"],
];
const MLB_PITCHING: [string, string][] = [
  ["earnedRunAverage", "era"],
  ["wins", "wins"],
  ["strikeouts", "so"],
  ["saves", "sv"],
];
export function parseMlbLeaders(hitting: MlbLeaders, pitching: MlbLeaders): StandingTableIn {
  const pick = (json: MlbLeaders, cats: [string, string][]) =>
    cats.flatMap(([cat, key]) => {
      const c = json.leagueLeaders.find((x) => x.leaderCategory === cat);
      if (!c?.leaders.length) return [];
      return [
        group(
          key,
          c.leaders.map((x) => ({
            rank: x.rank,
            name: x.person.fullName,
            ref: { source: "mlb", externalId: x.team ? String(x.team.id) : null, name: x.team?.name ?? "" },
            sub: x.team?.name,
            stats: { value: x.value },
          })),
        ),
      ];
    });
  return { kind: "leaders", season: null, groups: [...pick(hitting, MLB_HITTING), ...pick(pitching, MLB_PITCHING)] };
}

// --- NHL (api-web.nhle.com)
interface NhlLeader {
  firstName: { default: string };
  lastName: { default: string };
  teamName?: { default: string };
  teamAbbrev?: string;
  value: number;
}
export function parseNhlLeaders(skaters: Record<string, NhlLeader[]>, goalies: Record<string, NhlLeader[]>): StandingTableIn {
  const cats: [Record<string, NhlLeader[]>, string, string, (v: number) => string][] = [
    [skaters, "goals", "goals", String],
    [skaters, "assists", "assists", String],
    [skaters, "points", "points", String],
    [goalies, "wins", "gWins", String],
    [goalies, "goalsAgainstAverage", "gaa", (v) => fixed(v, 2)],
    [goalies, "savePctg", "svPct", rate],
  ];
  const groups = cats.flatMap(([src, cat, key, fmt]) => {
    const list = (src[cat] ?? []).slice(0, TOP);
    if (!list.length) return [];
    return [
      group(
        key,
        ranked(
          list,
          (x) => x.value,
          (x, rank) => ({
            rank,
            name: `${x.firstName.default} ${x.lastName.default}`,
            // 순위에는 팀 별칭('Wild')만 와서 이름 끝부분으로 연결한다
            ref: { source: "nhl", externalId: null, name: x.teamName?.default ?? "" },
            sub: x.teamAbbrev,
            stats: { value: fmt(x.value) },
          }),
        ),
      ),
    ];
  });
  return { kind: "leaders", season: null, groups };
}

// --- F1 (Jolpica): 우승·폴 포지션·포디움 횟수
interface JolpicaRaceResults {
  Results?: JolpicaPos[];
  QualifyingResults?: JolpicaPos[];
}
interface JolpicaPos {
  Driver: { driverId: string; familyName: string };
  Constructor: { name: string };
}
export function parseF1Leaders(wins: JolpicaRaceResults[], podiums: JolpicaRaceResults[], poles: JolpicaRaceResults[]): StandingTableIn {
  const count = (races: JolpicaRaceResults[]) => {
    const m = new Map<string, { n: number; name: string; team: string }>();
    for (const r of races) {
      for (const x of r.Results ?? r.QualifyingResults ?? []) {
        const cur = m.get(x.Driver.driverId) ?? { n: 0, name: x.Driver.familyName, team: x.Constructor.name };
        m.set(x.Driver.driverId, { ...cur, n: cur.n + 1, team: x.Constructor.name });
      }
    }
    const sorted = [...m].sort((a, b) => b[1].n - a[1].n);
    return ranked(
      sorted,
      ([, v]) => v.n,
      ([id, v], rank) => ({ rank, name: v.name, driverId: id, sub: v.team, stats: { value: String(v.n) } }),
    );
  };
  return {
    kind: "leaders",
    season: null,
    groups: [group("f1Wins", count(wins)), group("f1Poles", count(poles)), group("f1Podiums", count(podiums))].filter((g) => g.rows.length),
  };
}

const KBL_HEADERS = { Channel: "WEB", TeamCode: "XX", "X-Requested-With": "XMLHttpRequest", lang: "ko", Referer: "https://www.kbl.or.kr/" };
const kstYear = (now: Date) => String(new Date(now.getTime() + 9 * 3600_000).getUTCFullYear());

export type LeaderSpec =
  | { source: "football-data"; code: string }
  | { source: "espn"; path: string }
  | { source: "mlb" | "nhl" | "kbo" | "kbl" | "jolpica" }
  | { source: "kleague"; league: string }
  | { source: string };

// 개인 순위를 받을 수 있는 출처만 결과를 낸다 (LCK·UEL 등은 null)
export async function fetchLeaders(
  spec: LeaderSpec,
  opts: { fetcher?: Fetcher; footballDataKey?: string; now?: Date } = {},
): Promise<StandingTableIn | null> {
  const fetcher = opts.fetcher ?? fetch;
  const now = opts.now ?? new Date();
  switch (spec.source) {
    case "football-data": {
      if (!opts.footballDataKey || !("code" in spec)) return null;
      return parseFootballDataScorers(
        await getJson<FdScorers>(fetcher, `https://api.football-data.org/v4/competitions/${spec.code}/scorers?limit=10`, {
          "X-Auth-Token": opts.footballDataKey,
        }),
      );
    }
    case "espn": {
      if (!("path" in spec) || !ESPN_CATEGORIES[spec.path]) return null;
      return parseEspnLeaders(await getJson(fetcher, `https://site.api.espn.com/apis/site/v3/sports/${spec.path}/leaders`), spec.path);
    }
    case "mlb": {
      const year = now.getUTCFullYear();
      for (const season of [String(year), String(year - 1)]) {
        const url = (group: string, cats: [string, string][]) =>
          `https://statsapi.mlb.com/api/v1/stats/leaders?leaderCategories=${cats.map((c) => c[0]).join(",")}&statGroup=${group}&season=${season}&limit=${TOP}&sportId=1`;
        const hitting = await getJson<MlbLeaders>(fetcher, url("hitting", MLB_HITTING));
        if (!hitting.leagueLeaders.some((c) => c.leaders.length)) continue;
        const pitching = await getJson<MlbLeaders>(fetcher, url("pitching", MLB_PITCHING));
        return { ...parseMlbLeaders(hitting, pitching), season };
      }
      return null;
    }
    case "nhl": {
      const skaters = await getJson<Record<string, NhlLeader[]>>(
        fetcher,
        `https://api-web.nhle.com/v1/skater-stats-leaders/current?categories=goals,assists,points&limit=${TOP}`,
      );
      const goalies = await getJson<Record<string, NhlLeader[]>>(
        fetcher,
        `https://api-web.nhle.com/v1/goalie-stats-leaders/current?categories=wins,goalsAgainstAverage,savePctg&limit=${TOP}`,
      );
      return parseNhlLeaders(skaters, goalies);
    }
    case "kbo": {
      const res = await request(fetcher, "https://www.koreabaseball.com/Record/Ranking/Top5.aspx", { Accept: "text/html" });
      if (!res.ok) throw new SourceError(`KBO TOP5 ${res.status}`);
      return { ...parseKboLeaders(await res.text()), season: kstYear(now) };
    }
    case "kbl":
      return parseKblLeaders(await getJson<KblLeaderPart[]>(fetcher, "https://api.kbl.or.kr/league/season-leader", KBL_HEADERS));
    case "kleague": {
      if (!("league" in spec)) return null;
      const year = kstYear(now);
      const get = async (recordType: string) => {
        const res = await fetcher("https://www.kleague.com/record/rankSort.do", {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8", "X-Requested-With": "XMLHttpRequest", "Accept-Language": "ko-KR" },
          body: JSON.stringify({ year, leagueId: spec.league, recordType }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new SourceError(`K리그 개인 기록 ${res.status}`);
        const body = (await res.json()) as { data?: { list?: KleaguePlayer[] } };
        if (!Array.isArray(body.data?.list)) throw new SourceError("K리그 개인 기록 형식이 바뀌었습니다");
        return body.data.list;
      };
      return { ...parseKleagueLeaders(await get("GOAL"), await get("ASSIST")), season: year };
    }
    case "jolpica": {
      const base = "https://api.jolpi.ca/ergast/f1/current";
      type R = { MRData: { RaceTable: { Races: JolpicaRaceResults[] } } };
      const races = async (path: string) => {
        await sleep(300);
        return (await getJson<R>(fetcher, `${base}/${path}/?limit=100`)).MRData.RaceTable.Races;
      };
      const wins = await races("results/1");
      const podiums = [...wins, ...(await races("results/2")), ...(await races("results/3"))];
      return parseF1Leaders(wins, podiums, await races("qualifying/1"));
    }
    default:
      return null;
  }
}
