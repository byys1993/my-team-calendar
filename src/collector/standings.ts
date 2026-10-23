import type { Db } from "@/lib/db";
import { TEAM_CODE as KBO_TEAM_CODE } from "./sources/kbo";
import { getJson, request, sleep, SourceError } from "./sources/http";
import { fetchLeaders } from "./leaders";
import type { Fetcher } from "./types";

// 리그 순위표 수집. 경기 일정과 따로 몇 시간마다 받아 standing 표에 저장하고, 화면은 저장된 것을 보여 준다.
// 각 출처의 표를 아래 공통 모양으로 바꾼다. 팀은 출처의 팀 ID로 우리 팀(slug)에 연결해 '내 팀'을 강조할 수 있게 한다.

export type StatKey = "gp" | "w" | "d" | "l" | "otl" | "pts" | "gf" | "ga" | "gd" | "pct" | "gb" | "wins" | "value";

export interface StandingRowIn {
  rank: number;
  // 팀 연결용 (출처 이름, 출처 팀 ID). F1 드라이버처럼 팀이 아닌 줄은 없다.
  ref?: { source: string; externalId: string | null; name: string };
  name: string; // 원문 이름 (F1 은 드라이버 영문 성 또는 컨스트럭터)
  driverId?: string; // F1 드라이버 (한국어 이름용)
  sub?: string; // F1 드라이버의 소속 팀
  stats: Partial<Record<StatKey, number | string | null>>;
}

export interface StandingTableIn {
  // leaders: 개인 순위 TOP 5 (그룹 이름 = 부문 키, 예: 'hr', 'goals')
  kind: "teams" | "drivers" | "constructors" | "leaders";
  season: string | null;
  groups: { name: string | null; rows: StandingRowIn[] }[];
}

type Spec =
  | { source: "football-data"; code: string }
  | { source: "espn"; path: string }
  | { source: "mlb" }
  | { source: "nhl" }
  | { source: "kbo" }
  | { source: "kbl" }
  | { source: "kleague"; league: string }
  | { source: "lolesports"; league: string }
  | { source: "jolpica" };

// 대회 slug → 순위표 출처. 컵대회·국가대표처럼 순위표가 없는 대회는 넣지 않는다.
export const STANDINGS: Record<string, Spec> = {
  epl: { source: "football-data", code: "PL" },
  laliga: { source: "football-data", code: "PD" },
  bundesliga: { source: "football-data", code: "BL1" },
  "serie-a": { source: "football-data", code: "SA" },
  "ligue-1": { source: "football-data", code: "FL1" },
  ucl: { source: "football-data", code: "CL" },
  uel: { source: "espn", path: "soccer/uefa.europa" },
  uecl: { source: "espn", path: "soccer/uefa.europa.conf" },
  nba: { source: "espn", path: "basketball/nba" },
  nfl: { source: "espn", path: "football/nfl" },
  mlb: { source: "mlb" },
  nhl: { source: "nhl" },
  kbo: { source: "kbo" },
  kbl: { source: "kbl" },
  "k-league-1": { source: "kleague", league: "1" },
  "k-league-2": { source: "kleague", league: "2" },
  lck: { source: "lolesports", league: "98767991310872058" },
  f1: { source: "jolpica" },
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/^\+/, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const pct = (w: number, l: number) => (w + l > 0 ? Math.round((w / (w + l)) * 1000) / 1000 : null);

// --- football-data.org (유럽 리그·UCL)
interface FdStandings {
  season?: { startDate?: string };
  standings: {
    type: string;
    group: string | null;
    table: {
      position: number;
      team: { id: number; name: string; shortName?: string };
      playedGames: number;
      won: number;
      draw: number;
      lost: number;
      points: number;
      goalsFor: number;
      goalsAgainst: number;
      goalDifference: number;
    }[];
  }[];
}

export function parseFootballDataStandings(json: FdStandings): StandingTableIn {
  return {
    kind: "teams",
    season: json.season?.startDate?.slice(0, 4) ?? null,
    groups: json.standings
      .filter((s) => s.type === "TOTAL")
      .map((s) => ({
        name: s.group,
        rows: s.table.map((r) => ({
          rank: r.position,
          ref: { source: "football-data", externalId: String(r.team.id), name: r.team.name },
          name: r.team.shortName ?? r.team.name,
          stats: { gp: r.playedGames, w: r.won, d: r.draw, l: r.lost, gf: r.goalsFor, ga: r.goalsAgainst, gd: r.goalDifference, pts: r.points },
        })),
      })),
  };
}

// --- ESPN (NBA·NFL·UEL·UECL)
interface EspnEntry {
  team: { id: string; displayName: string; shortDisplayName?: string };
  stats: { name: string; value?: number; displayValue?: string }[];
}
interface EspnStandingsNode {
  name?: string;
  season?: number;
  children?: EspnStandingsNode[];
  standings?: { entries: EspnEntry[]; season?: number };
}

export function parseEspnStandings(json: EspnStandingsNode, path: string): StandingTableIn {
  const soccer = path.startsWith("soccer/");
  const league = path.split("/")[1];
  const nodes = json.children?.length ? json.children : [json];
  let season: string | null = null;
  const groups = nodes.map((node) => {
    season ??= node.standings?.season ? String(node.standings.season) : null;
    const rows = (node.standings?.entries ?? []).map((e) => {
      const s = Object.fromEntries(e.stats.map((x) => [x.name, x.value ?? num(x.displayValue)]));
      const w = num(s.wins) ?? 0;
      const l = num(s.losses) ?? 0;
      return {
        sortKey: soccer ? (num(s.rank) ?? 99) : (num(s.playoffSeed) ?? 99),
        winPct: num(s.winPercent) ?? pct(w, l) ?? 0,
        row: {
          rank: 0,
          ref: { source: "espn", externalId: soccer ? e.team.id : `${league}:${e.team.id}`, name: e.team.displayName },
          name: e.team.shortDisplayName ?? e.team.displayName,
          stats: soccer
            ? {
                gp: num(s.gamesPlayed),
                w,
                d: num(s.ties),
                l,
                gf: num(s.pointsFor),
                ga: num(s.pointsAgainst),
                gd: num(s.pointDifferential),
                pts: num(s.points),
              }
            : { w, l, d: num(s.ties), pct: num(s.winPercent) ?? pct(w, l), gb: num(s.gamesBehind) },
        } as StandingRowIn,
      };
    });
    // 축구는 공식 순위, 미국 리그는 플레이오프 시드(없으면 승률) 순
    rows.sort((a, b) => a.sortKey - b.sortKey || b.winPct - a.winPct);
    return { name: node.name ?? null, rows: rows.map((r, i) => ({ ...r.row, rank: i + 1 })) };
  });
  return { kind: "teams", season, groups };
}

// --- MLB Stats API
interface MlbStandings {
  records: {
    division?: { name?: string };
    teamRecords: { team: { id: number; name: string }; divisionRank: string; wins: number; losses: number; winningPercentage: string; gamesBack: string }[];
  }[];
}
export function parseMlbStandings(json: MlbStandings, season: string): StandingTableIn {
  return {
    kind: "teams",
    season,
    groups: json.records.map((r) => ({
      name: r.division?.name ?? null,
      rows: r.teamRecords.map((t) => ({
        rank: Number(t.divisionRank),
        ref: { source: "mlb", externalId: String(t.team.id), name: t.team.name },
        name: t.team.name,
        stats: { w: t.wins, l: t.losses, pct: num(t.winningPercentage), gb: t.gamesBack === "-" ? 0 : num(t.gamesBack) },
      })),
    })),
  };
}

// --- NHL (api-web.nhle.com): 컨퍼런스별
interface NhlStanding {
  conferenceName: string;
  conferenceSequence: number;
  teamName: { default: string };
  teamAbbrev: { default: string };
  gamesPlayed: number;
  wins: number;
  losses: number;
  otLosses: number;
  points: number;
  seasonId?: number;
}
export function parseNhlStandings(json: { standings: NhlStanding[] }): StandingTableIn {
  const byConf = new Map<string, NhlStanding[]>();
  for (const s of json.standings) byConf.set(s.conferenceName, [...(byConf.get(s.conferenceName) ?? []), s]);
  const sid = json.standings[0]?.seasonId ? String(json.standings[0].seasonId) : null;
  return {
    kind: "teams",
    season: sid ? `${sid.slice(0, 4)}-${sid.slice(6, 8)}` : null,
    groups: [...byConf].map(([name, list]) => ({
      name,
      rows: list
        .sort((a, b) => a.conferenceSequence - b.conferenceSequence)
        .map((s) => ({
          rank: s.conferenceSequence,
          // NHL 순위표에는 팀 ID가 없어 이름으로 연결한다
          ref: { source: "nhl", externalId: null, name: s.teamName.default },
          name: s.teamName.default,
          stats: { gp: s.gamesPlayed, w: s.wins, l: s.losses, otl: s.otLosses, pts: s.points },
        })),
    })),
  };
}

// --- KBO 공식 홈페이지 팀 순위 화면 (HTML 표)
export function parseKboStandings(html: string, season: string): StandingTableIn {
  const table = html.match(/<table summary="순위, 팀명[^"]*" class="tData">([\s\S]*?)<\/table>/)?.[1] ?? "";
  const body = table.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  const rows: StandingRowIn[] = [];
  for (const tr of body.match(/<tr>[\s\S]*?<\/tr>/g) ?? []) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]*>/g, "").trim());
    if (cells.length < 8) continue;
    const [rank, name, gp, w, l, d, wpct, gb] = cells;
    rows.push({
      rank: Number(rank),
      ref: { source: "kbo", externalId: KBO_TEAM_CODE[name] ?? null, name },
      name,
      stats: { gp: num(gp), w: num(w), l: num(l), d: num(d), pct: num(wpct), gb: num(gb) ?? 0 },
    });
  }
  if (rows.length === 0) throw new SourceError("KBO 순위표 형식이 바뀌었습니다");
  return { kind: "teams", season, groups: [{ name: null, rows }] };
}

// --- KBL (api.kbl.or.kr, 현재 시즌)
interface KblRank {
  rank: number;
  tcode: string;
  tname: string;
  win: number;
  loss: number;
  winDiff: number;
}
export function parseKblStandings(list: KblRank[]): StandingTableIn {
  return {
    kind: "teams",
    season: null,
    groups: [
      {
        name: null,
        rows: list.map((r) => ({
          rank: r.rank,
          ref: { source: "kbl", externalId: r.tcode, name: r.tname },
          name: r.tname,
          stats: { gp: r.win + r.loss, w: r.win, l: r.loss, pct: pct(r.win, r.loss), gb: r.winDiff },
        })),
      },
    ],
  };
}

// --- K리그 공식 홈페이지
interface KleagueRank {
  rank: number;
  teamId: string;
  teamName: string;
  gameCount: number;
  winCnt: number;
  tieCnt: number;
  lossCnt: number;
  gainGoal: number;
  lossGoal: number;
  gapCnt: number;
  gainPoint: number;
}
export function parseKleagueStandings(list: KleagueRank[], season: string): StandingTableIn {
  return {
    kind: "teams",
    season,
    groups: [
      {
        name: null,
        rows: list.map((r) => ({
          rank: r.rank,
          ref: { source: "kleague", externalId: r.teamId, name: r.teamName },
          name: r.teamName,
          stats: { gp: r.gameCount, w: r.winCnt, d: r.tieCnt, l: r.lossCnt, gf: r.gainGoal, ga: r.lossGoal, gd: r.gapCnt, pts: r.gainPoint },
        })),
      },
    ],
  };
}

// --- LoL Esports: 가장 최근에 시작한 대회의 그룹별 순위
interface LolStandings {
  data: {
    standings: {
      stages: {
        name: string;
        sections: {
          name: string;
          rankings?: { ordinal: number; teams: { code: string; name: string; record?: { wins: number; losses: number } }[] }[];
        }[];
      }[];
    }[];
  };
}
export function parseLolStandings(json: LolStandings, season: string | null): StandingTableIn {
  const groups: StandingTableIn["groups"] = [];
  for (const stage of json.data.standings[0]?.stages ?? []) {
    for (const sec of stage.sections) {
      if (!sec.rankings?.length) continue;
      groups.push({
        name: sec.name,
        rows: sec.rankings.flatMap((r) =>
          r.teams.map((t) => ({
            rank: r.ordinal,
            ref: { source: "lolesports", externalId: t.code, name: t.name },
            name: t.name,
            stats: { w: t.record?.wins ?? null, l: t.record?.losses ?? null },
          })),
        ),
      });
    }
  }
  return { kind: "teams", season, groups };
}

// --- F1 (Jolpica): 드라이버·컨스트럭터
interface JolpicaStandingsList {
  season: string;
  DriverStandings?: { position?: string; positionText: string; points: string; wins: string; Driver: { driverId: string; familyName: string }; Constructors: { name: string }[] }[];
  ConstructorStandings?: { position?: string; positionText: string; points: string; wins: string; Constructor: { name: string } }[];
}
export function parseF1Standings(drivers: JolpicaStandingsList | undefined, teams: JolpicaStandingsList | undefined): StandingTableIn[] {
  const out: StandingTableIn[] = [];
  if (drivers?.DriverStandings) {
    out.push({
      kind: "drivers",
      season: drivers.season,
      groups: [
        {
          name: null,
          rows: drivers.DriverStandings.map((d, i) => ({
            rank: Number(d.position ?? i + 1),
            name: d.Driver.familyName,
            driverId: d.Driver.driverId,
            sub: d.Constructors.at(-1)?.name,
            stats: { pts: num(d.points), wins: num(d.wins) },
          })),
        },
      ],
    });
  }
  if (teams?.ConstructorStandings) {
    out.push({
      kind: "constructors",
      season: teams.season,
      groups: [
        {
          name: null,
          rows: teams.ConstructorStandings.map((c, i) => ({
            rank: Number(c.position ?? i + 1),
            name: c.Constructor.name,
            stats: { pts: num(c.points), wins: num(c.wins) },
          })),
        },
      ],
    });
  }
  return out;
}

const kstYear = (now: Date) => String(new Date(now.getTime() + 9 * 3600_000).getUTCFullYear());

const KBL_HEADERS = { Channel: "WEB", TeamCode: "XX", "X-Requested-With": "XMLHttpRequest", lang: "ko", Referer: "https://www.kbl.or.kr/" };

export async function fetchStandings(
  spec: Spec,
  opts: { fetcher?: Fetcher; footballDataKey?: string; now?: Date } = {},
): Promise<StandingTableIn[]> {
  const fetcher = opts.fetcher ?? fetch;
  const now = opts.now ?? new Date();
  switch (spec.source) {
    case "football-data": {
      if (!opts.footballDataKey) throw new SourceError("FOOTBALL_DATA_API_KEY 없음");
      const json = await getJson<FdStandings>(
        fetcher,
        `https://api.football-data.org/v4/competitions/${spec.code}/standings`,
        { "X-Auth-Token": opts.footballDataKey },
      );
      return [parseFootballDataStandings(json)];
    }
    case "espn":
      return [parseEspnStandings(await getJson(fetcher, `https://site.api.espn.com/apis/v2/sports/${spec.path}/standings`), spec.path)];
    case "mlb": {
      // 시즌 전(1~3월)에는 올해 순위가 비어 있으니 지난 시즌을 보여 준다
      const year = now.getUTCFullYear();
      for (const season of [String(year), String(year - 1)]) {
        const json = await getJson<MlbStandings>(
          fetcher,
          `https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason&hydrate=division`,
        );
        if (json.records.some((r) => r.teamRecords.length)) return [parseMlbStandings(json, season)];
      }
      return [];
    }
    case "nhl":
      return [parseNhlStandings(await getJson(fetcher, "https://api-web.nhle.com/v1/standings/now"))];
    case "kbo": {
      const res = await request(fetcher, "https://www.koreabaseball.com/Record/TeamRank/TeamRankDaily.aspx", { Accept: "text/html" });
      if (!res.ok) throw new SourceError(`KBO 순위 ${res.status}`);
      return [parseKboStandings(await res.text(), kstYear(now))];
    }
    case "kbl":
      return [parseKblStandings(await getJson<KblRank[]>(fetcher, "https://api.kbl.or.kr/league/rank/team", KBL_HEADERS))];
    case "kleague": {
      const year = kstYear(now);
      // POST 본문으로 보내면 리그 번호를 무시하고 K리그1 을 준다. 화면처럼 주소에 붙여 보낸다.
      const res = await request(
        fetcher,
        `https://www.kleague.com/record/teamRank.do?leagueId=${spec.league}&year=${year}&stadium=all&recordType=rank`,
        { "X-Requested-With": "XMLHttpRequest", "Accept-Language": "ko-KR" },
      );
      if (!res.ok) throw new SourceError(`K리그 순위 ${res.status}`);
      const body = (await res.json()) as { data?: { teamRank?: KleagueRank[] } };
      if (!Array.isArray(body.data?.teamRank)) throw new SourceError("K리그 순위 형식이 바뀌었습니다");
      return [parseKleagueStandings(body.data.teamRank, year)];
    }
    case "lolesports": {
      const headers = { "x-api-key": "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z" };
      const base = "https://esports-api.lolesports.com/persisted/gw";
      const t = await getJson<{ data: { leagues: { tournaments: { id: string; startDate: string }[] }[] } }>(
        fetcher,
        `${base}/getTournamentsForLeague?hl=ko-KR&leagueId=${spec.league}`,
        headers,
      );
      // 이미 시작한 대회 중 가장 최근 것부터, 순위가 있는 첫 대회
      const started = t.data.leagues[0].tournaments
        .filter((x) => new Date(x.startDate).getTime() <= now.getTime())
        .sort((a, b) => b.startDate.localeCompare(a.startDate));
      for (const tour of started.slice(0, 3)) {
        const json = await getJson<LolStandings>(fetcher, `${base}/getStandings?hl=ko-KR&tournamentId=${tour.id}`, headers);
        const table = parseLolStandings(json, tour.startDate.slice(0, 4));
        if (table.groups.length) return [table];
      }
      return [];
    }
    case "jolpica": {
      const base = "https://api.jolpi.ca/ergast/f1/current";
      type L = { MRData: { StandingsTable: { StandingsLists: JolpicaStandingsList[] } } };
      const d = await getJson<L>(fetcher, `${base}/driverStandings/`);
      await sleep(300);
      const c = await getJson<L>(fetcher, `${base}/constructorStandings/`);
      return parseF1Standings(d.MRData.StandingsTable.StandingsLists[0], c.MRData.StandingsTable.StandingsLists[0]);
    }
  }
}

// 출처 팀 → 우리 팀 slug. 출처 ID가 없거나 연결이 없으면 영문·한국어 이름·별칭으로 찾는다.
async function teamResolver(db: Db, sport: string) {
  const refs = await db.query<{ source: string; external_id: string; slug: string }>(
    `select r.source, r.external_id, t.slug from team_source_ref r join team t on t.id = r.team_id
     join sport s on s.id = t.sport_id where s.slug = $1`,
    [sport],
  );
  const teams = await db.query<{ slug: string; name_en: string; name_ko: string; short_ko: string | null; aliases: string[] | null }>(
    `select t.slug, t.name_en, t.name_ko, t.short_ko, t.aliases from team t join sport s on s.id = t.sport_id
     where s.slug = $1 and not t.needs_review`,
    [sport],
  );
  const byRef = new Map(refs.map((r) => [`${r.source}|${r.external_id}`, r.slug]));
  // 악센트를 떼고 비교한다 (Montréal → montreal)
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]/g, "");
  const byName = new Map<string, string>();
  for (const t of teams) {
    for (const n of [t.name_en, t.name_ko, t.short_ko, ...(t.aliases ?? [])]) if (n) byName.set(norm(n), t.slug);
  }
  // 'Wild' 처럼 팀 별칭만 올 때: 정식 영문명이 그 별칭으로 끝나는 팀이 하나뿐이면 그 팀
  const bySuffix = (n: string) => {
    if (n.length < 4) return null;
    const hits = teams.filter((t) => norm(t.name_en).endsWith(n));
    return hits.length === 1 ? hits[0].slug : null;
  };
  return (ref: StandingRowIn["ref"]): string | null => {
    if (!ref) return null;
    // 'Arsenal FC' 처럼 FC·CF 가 붙은 이름도 맞춰 본다
    const bare = ref.name.replace(/\b(A?FC|CF|SC|AC)\b/gi, "");
    return (
      (ref.externalId && byRef.get(`${ref.source}|${ref.externalId}`)) ||
      byName.get(norm(ref.name)) ||
      byName.get(norm(bare)) ||
      bySuffix(norm(ref.name)) ||
      null
    );
  };
}

export const STANDINGS_MAX_AGE_H = 3;

export interface StandingsResult {
  competition: string;
  ok: boolean;
  tables?: number;
  error?: string;
}

// 순위표를 받아 저장한다. 대회마다 3시간에 한 번 (force 면 전부).
export async function syncStandings(
  db: Db,
  opts: {
    force?: boolean;
    only?: string[];
    log?: (s: string) => void;
    fetcher?: Fetcher;
    footballDataKey?: string;
    now?: Date;
    footballDataGapMs?: number;
  } = {},
): Promise<StandingsResult[]> {
  const gap = opts.footballDataGapMs ?? 7000;
  const log = opts.log ?? (() => {});
  const now = opts.now ?? new Date();
  const comps = await db.query<{ id: number; slug: string; sport: string; updated_at: Date | null }>(
    `select c.id, c.slug, s.slug as sport, (select min(st.updated_at) from standing st where st.competition_id = c.id) as updated_at
     from competition c join sport s on s.id = c.sport_id order by c.id`,
  );
  const results: StandingsResult[] = [];
  let lastFootballData = 0;
  for (const c of comps) {
    const spec = STANDINGS[c.slug];
    if (!spec || (opts.only && !opts.only.includes(c.slug))) continue;
    const fresh = c.updated_at && now.getTime() - c.updated_at.getTime() < STANDINGS_MAX_AGE_H * 3600_000;
    if (fresh && !opts.force) continue;
    try {
      // football-data 무료 키는 분당 10회: 순위표 요청 사이를 7초 띄운다
      if (spec.source === "football-data") {
        const wait = lastFootballData + gap - Date.now();
        if (wait > 0) await sleep(wait);
        lastFootballData = Date.now();
      }
      const tables = await fetchStandings(spec, { fetcher: opts.fetcher, footballDataKey: opts.footballDataKey, now });
      // 개인 순위 TOP 5: 실패해도 순위표는 저장한다
      try {
        if (spec.source === "football-data") {
          const wait = lastFootballData + gap - Date.now();
          if (wait > 0) await sleep(wait);
          lastFootballData = Date.now();
        }
        const leaders = await fetchLeaders(spec, { fetcher: opts.fetcher, footballDataKey: opts.footballDataKey, now });
        if (leaders?.groups.length) tables.push(leaders);
      } catch (err) {
        log(`${c.slug} 개인 순위 실패: ${err instanceof Error ? err.message : String(err)}`);
      }
      const resolve = await teamResolver(db, c.sport);
      for (const t of tables) {
        const groups = t.groups.map((g) => ({
          name: g.name,
          rows: g.rows.map((r) => ({
            rank: r.rank,
            team: resolve(r.ref),
            name: r.name,
            ...(r.driverId ? { driverId: r.driverId } : {}),
            ...(r.sub ? { sub: r.sub } : {}),
            stats: r.stats,
          })),
        }));
        await db.query(
          `insert into standing (competition_id, kind, season, groups, source, updated_at)
           values ($1, $2, $3, $4::text::jsonb, $5, $6)
           on conflict (competition_id, kind) do update set season = excluded.season, groups = excluded.groups,
             source = excluded.source, updated_at = excluded.updated_at`,
          [c.id, t.kind, t.season, JSON.stringify(groups), spec.source, now.toISOString()],
        );
      }
      log(`${c.slug} 순위표: ${spec.source} ${tables.map((t) => `${t.kind} ${t.groups.reduce((n, g) => n + g.rows.length, 0)}줄`).join(", ")}`);
      results.push({ competition: c.slug, ok: true, tables: tables.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`${c.slug} 순위표 실패: ${message}`);
      results.push({ competition: c.slug, ok: false, error: message });
    }
  }
  return results;
}
