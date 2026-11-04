import type { Db } from "@/lib/db";
import type { Fetcher } from "@/collector/types";
import { getJson } from "@/collector/sources/http";
import { kovoGet } from "@/collector/sources/kovo";
import {
  BOX_COMPETITIONS,
  parseEspn,
  parseKbo,
  parseMlb,
  parseNhl,
  SOCCER_BOX_COMPETITIONS,
  type BoxScore,
  type EspnSummary,
  type KboBoard,
  type KboBox,
  type MlbBox,
  type MlbLinescore,
  type NhlBox,
  type NhlRail,
  KLEAGUE_BOX_COMPETITIONS,
  KOVO_BOX_COMPETITIONS,
  LOL_BOX_COMPETITIONS,
} from "@/lib/boxscore";
import {
  parseKbl,
  parseKleague,
  parseKleagueLineup,
  parseKovo,
  parseLol,
  type KblMatch,
  type KblPlayerStat,
  type KblTeamRecord,
  type KleagueInfo,
  type KleagueRecord,
  type KovoDetail,
  type LolEventDetails,
  type LolWindow,
} from "@/lib/boxscoreKr";
import { parseF1, parseF1Ref, type F1Kind, type JolpicaRaceResult } from "@/lib/boxscoreF1";

// 기록지는 누가 처음 열어 볼 때 출처에서 받아 저장한다 (전부 미리 받으면 출처에 부담).
// 경기 직후에는 기록이 고쳐질 수 있어, 경기 시작 12시간 안에 받은 것은 30분 지나면 다시 받는다.
const SETTLED_MS = 12 * 3600_000;
const REFRESH_MS = 30 * 60_000;
// 3년(3시즌) 지난 기록지는 정리한다 (cleanup.ts). 다시 열면 그때 또 받는다.
export const BOX_KEEP_DAYS = 3 * 365;

const ESPN = "https://site.api.espn.com/apis/site/v2/sports";

export async function getBoxScore(db: Db, matchId: string, opts: { fetcher?: Fetcher; now?: Date } = {}): Promise<BoxScore | null> {
  const fetcher = opts.fetcher ?? fetch;
  const now = opts.now ?? new Date();
  const [row] = await db.query<{
    competition: string;
    start_at: Date | string | null;
    home_team_id: number | null;
    away_team_id: number | null;
    home_score: number | null;
    podium: unknown;
    data: BoxScore | null;
    fetched_at: Date | string | null;
  }>(
    `select c.slug as competition, m.start_at, m.home_team_id, m.away_team_id, m.home_score, m.podium, b.data, b.fetched_at
     from match m join competition c on c.id = m.competition_id
     left join boxscore b on b.match_id = m.id
     where m.id = $1`,
    [matchId],
  );
  if (!row || (row.home_score == null && !row.podium) || !BOX_COMPETITIONS.has(row.competition)) return null;

  if (row.data && row.fetched_at) {
    const fetched = new Date(row.fetched_at).getTime();
    const start = row.start_at ? new Date(row.start_at).getTime() : 0;
    if (fetched - start > SETTLED_MS || now.getTime() - fetched < REFRESH_MS) return row.data;
  }

  // 차례로 조회 (한 연결에 동시에 보내면 Supabase 풀러에서 멈춘다)
  const refs = await db.query<{ source: string; external_id: string }>(
    "select source, external_id from match_source_ref where match_id = $1",
    [matchId],
  );
  const paths = await db.query<{ external_id: string }>(
    `select r.external_id from competition_source_ref r join competition c on c.id = r.competition_id
     where c.slug = $1 and r.source = 'espn'`,
    [row.competition],
  );
  const game: Game = {
    competition: row.competition,
    startAt: row.start_at ? new Date(row.start_at).toISOString() : null,
    ref: (source) => refs.find((r) => r.source === source)?.external_id,
    espnPath: paths[0]?.external_id,
    espnEvent: row.data?.ref, // 전에 찾아 둔 ESPN 축구 경기 ID
    now,
    teams: async () => {
      const t = await db.query<TeamInfo & { id: number }>(
        `select t.id, r.external_id as espn, t.name_en, t.aliases from team t
         left join team_source_ref r on r.team_id = t.id and r.source = 'espn'
         where t.id in ($1, $2)`,
        [row.home_team_id ?? 0, row.away_team_id ?? 0],
      );
      return { home: t.filter((x) => x.id === row.home_team_id), away: t.filter((x) => x.id === row.away_team_id) };
    },
  };

  let box: BoxScore | null = null;
  try {
    box = await fetchBox(fetcher, game);
  } catch (e) {
    if (row.data) return row.data; // 출처가 잠깐 안 되면 저장해 둔 것이라도
    throw e;
  }
  if (!box) return row.data;
  await db.query(
    `insert into boxscore (match_id, data, fetched_at) values ($1, $2::text::jsonb, $3)
     on conflict (match_id) do update set data = excluded.data, fetched_at = excluded.fetched_at`,
    [matchId, JSON.stringify(box), now.toISOString()],
  );
  return box;
}

type TeamInfo = { espn: string | null; name_en: string; aliases: string[] };
interface Game {
  competition: string;
  startAt: string | null;
  ref(source: string): string | undefined;
  espnPath: string | undefined;
  espnEvent: string | undefined;
  now: Date;
  teams(): Promise<{ home: TeamInfo[]; away: TeamInfo[] }>;
}

async function fetchBox(fetcher: Fetcher, g: Game): Promise<BoxScore | null> {
  const mlb = g.ref("mlb");
  if (g.competition === "mlb" && mlb) {
    const box = await getJson<MlbBox>(fetcher, `https://statsapi.mlb.com/api/v1/game/${mlb}/boxscore`);
    const ls = await getJson<MlbLinescore>(fetcher, `https://statsapi.mlb.com/api/v1/game/${mlb}/linescore`).catch(() => null);
    return parseMlb(box, ls);
  }
  const nhl = g.ref("nhl");
  if (g.competition === "nhl" && nhl) {
    const box = await getJson<NhlBox>(fetcher, `https://api-web.nhle.com/v1/gamecenter/${nhl}/boxscore`);
    const rail = await getJson<NhlRail>(fetcher, `https://api-web.nhle.com/v1/gamecenter/${nhl}/right-rail`).catch(() => null);
    return parseNhl(box, rail);
  }
  const kbo = g.ref("kbo");
  if (g.competition === "kbo" && kbo) return fetchKbo(fetcher, kbo);
  const kbl = g.ref("kbl");
  if (g.competition === "kbl" && kbl) return fetchKbl(fetcher, kbl);
  const kleague = g.ref("kleague");
  if (KLEAGUE_BOX_COMPETITIONS.has(g.competition) && kleague) return fetchKleague(fetcher, kleague, g.competition);
  const kovo = g.ref("kovo");
  if (KOVO_BOX_COMPETITIONS.has(g.competition) && kovo) return fetchKovo(fetcher, kovo, g.competition);
  const f1 = parseF1Ref(g.ref("jolpica") ?? "");
  if (g.competition === "f1") return f1 ? fetchF1(fetcher, f1) : null;
  const lol = g.ref("lolesports");
  if (LOL_BOX_COMPETITIONS.has(g.competition) && lol) return fetchLol(fetcher, lol, g.startAt, g.now);

  if (SOCCER_BOX_COMPETITIONS.has(g.competition)) {
    const event = g.espnEvent ?? g.ref("espn") ?? (await findEspnSoccer(fetcher, g));
    if (!event) return null;
    // 축구 경기 요약은 리그와 상관없이 soccer/all 경로로 받을 수 있다
    const json = await getJson<EspnSummary>(fetcher, `${ESPN}/soccer/all/summary?event=${event}`);
    return json.boxscore ? { ...parseEspn(json, "soccer/all"), ref: event } : null;
  }
  const espn = g.ref("espn");
  if (espn && g.espnPath) {
    const json = await getJson<EspnSummary>(fetcher, `${ESPN}/${g.espnPath}/summary?event=${espn}`);
    return json.boxscore ? parseEspn(json, g.espnPath) : null;
  }
  return null;
}

// 팀 이름 비교용: 악센트·FC 같은 꼬리말·기호를 뗀다
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(fc|cf|afc|sc|ac|ssc|as|club|calcio)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

interface EspnCompetitor {
  homeAway: "home" | "away";
  team: { id: string; displayName: string };
}

// 유럽 리그는 football-data 에서 받아 ESPN 경기 ID가 없다 → 그날 ESPN 리그 일정에서 같은 두 팀 경기를 찾는다
async function findEspnSoccer(fetcher: Fetcher, g: Game): Promise<string | undefined> {
  const path = g.espnPath?.split("|")[0];
  if (!path?.startsWith("soccer/") || !g.startAt) return undefined;
  const teams = await g.teams();
  const same = (list: TeamInfo[], c: EspnCompetitor) =>
    list.some(
      (t) =>
        (t.espn && t.espn === c.team.id) || [t.name_en, ...t.aliases].some((n) => norm(n) !== "" && norm(n) === norm(c.team.displayName)),
    );
  // ESPN 날짜는 미국 동부 기준이라 시작 시각과 6시간 전 날짜를 본다
  const start = new Date(g.startAt).getTime();
  const days = [...new Set([start - 6 * 3600_000, start].map((t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, "")))];
  for (const day of days) {
    const sb = await getJson<{ events?: { id: string; competitions: { competitors: EspnCompetitor[] }[] }[] }>(
      fetcher,
      `${ESPN}/${path}/scoreboard?dates=${day}`,
    );
    for (const e of sb.events ?? []) {
      const cs = e.competitions[0]?.competitors ?? [];
      const home = cs.find((c) => c.homeAway === "home");
      const away = cs.find((c) => c.homeAway === "away");
      if (home && away && same(teams.home, home) && same(teams.away, away)) return e.id;
    }
  }
  return undefined;
}

// KBO 경기센터: 경기 ID(20261027HTSS0) 앞 8자리가 날짜. 기록 조회에는 시리즈 번호(정규 0, 포스트시즌 3·4·5·7)가
// 필요해 그날 경기 목록에서 먼저 찾는다.
const KBO_HEADERS = {
  "User-Agent": "my-team-calendar (non-commercial fan project)",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  Referer: "https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx",
};

async function kboPost<T>(fetcher: Fetcher, url: string, body: Record<string, string>): Promise<T> {
  const r = await fetcher(url, {
    method: "POST",
    headers: KBO_HEADERS,
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`${r.status} — ${url}`);
  return (await r.json()) as T;
}

async function fetchKbo(fetcher: Fetcher, gameId: string): Promise<BoxScore | null> {
  const list = await kboPost<{ game?: { G_ID: string; SR_ID: number | string; SEASON_ID: number | string; LE_ID: number | string }[] }>(
    fetcher,
    "https://www.koreabaseball.com/ws/Main.asmx/GetKboGameList",
    { leId: "1", srId: "0,1,3,4,5,6,7,8,9", date: gameId.slice(0, 8) },
  );
  const game = list.game?.find((x) => x.G_ID === gameId);
  if (!game) return null;
  const body = { leId: String(game.LE_ID), srId: String(game.SR_ID), seasonId: String(game.SEASON_ID), gameId };
  const box = await kboPost<KboBox & { code?: string }>(fetcher, "https://www.koreabaseball.com/ws/Schedule.asmx/GetBoxScoreScroll", body);
  if (box.code !== "100") return null;
  const board = await kboPost<KboBoard & { code?: string }>(
    fetcher,
    "https://www.koreabaseball.com/ws/Schedule.asmx/GetScoreBoardScroll",
    body,
  ).catch(() => null);
  return parseKbo(box, board?.code === "100" ? board : null);
}

// KBL 공식 홈페이지 데이터: 홈페이지가 보내는 헤더가 있어야 응답한다
const KBL_API = "https://api.kbl.or.kr/match";
const KBL_HEADERS = { Channel: "WEB", TeamCode: "XX", "X-Requested-With": "XMLHttpRequest", lang: "ko", Referer: "https://www.kbl.or.kr/" };

async function fetchKbl(fetcher: Fetcher, gmkey: string): Promise<BoxScore | null> {
  const id = encodeURIComponent(gmkey);
  const match = await getJson<KblMatch>(fetcher, `${KBL_API}/${id}`, KBL_HEADERS);
  if (!match.game) return null;
  const players = await getJson<KblPlayerStat[]>(fetcher, `${KBL_API}/${id}/player-stat`, KBL_HEADERS);
  const teams = await getJson<KblTeamRecord[]>(fetcher, `${KBL_API}/${id}/team-record`, KBL_HEADERS).catch(() => []);
  return parseKbl(match, Array.isArray(players) ? players : [], Array.isArray(teams) ? teams : []);
}

// V-리그 경기 상세: 경기 ID는 '시즌-리그-경기번호' (예: 023-201-2)
async function fetchKovo(fetcher: Fetcher, ref: string, competition: string): Promise<BoxScore | null> {
  const [season, league, gnum] = ref.split("-");
  if (!season || !league || !gnum) return null;
  const gender = competition === "v-league-women" ? "2" : "1";
  return parseKovo(await kovoGet<KovoDetail>(fetcher, `/stat/game-schedule/${gnum}?seasonCode=${season}&leagueCode=${league}&gender=${gender}`));
}

// K리그 경기센터: 골·카드(matchInfo)와 팀 기록(matchRecord)은 JSON, 출전 명단은 경기 화면 HTML 에만 있다.
// 경기 ID는 '연도-대회차수-경기번호' (예: 2026-1-198)
async function fetchKleague(fetcher: Fetcher, ref: string, competition: string): Promise<BoxScore | null> {
  const [year, meetSeq, gameId] = ref.split("-");
  if (!year || !meetSeq || !gameId) return null;
  const headers = {
    "User-Agent": "my-team-calendar (non-commercial fan project)",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Accept-Language": "ko-KR,ko;q=0.9",
    Referer: "https://www.kleague.com/match.do",
  };
  const post = async <T>(path: string): Promise<T | null> => {
    const r = await fetcher(`https://www.kleague.com/api/ddf/match/${path}.do`, {
      method: "POST",
      headers,
      body: new URLSearchParams({ year, meetSeq, gameId }).toString(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`${r.status} — kleague ${path}`);
    const json = (await r.json()) as { resultCode?: string | number; data?: T };
    return String(json.resultCode) === "200" ? (json.data ?? null) : null;
  };
  const info = await post<KleagueInfo>("matchInfo");
  if (!info) return null;
  const record = await post<KleagueRecord>("matchRecord").catch(() => null);
  const leagueId = competition === "k-league-2" ? "2" : "1";
  const page = await fetcher(`https://www.kleague.com/match.do?year=${year}&leagueId=${leagueId}&gameId=${gameId}&meetSeq=${meetSeq}`, {
    headers: { "User-Agent": headers["User-Agent"], "Accept-Language": headers["Accept-Language"] },
    signal: AbortSignal.timeout(30_000),
  })
    .then((r) => (r.ok ? r.text() : null))
    .catch(() => null);
  return parseKleague(info, record, page ? parseKleagueLineup(page) : null);
}

// LoL Esports: 경기 상세에서 세트 ID를 받고, 세트마다 실시간 기록(livestats)의 마지막 화면을 받는다.
// 마지막 화면은 세트가 끝난 뒤 시각을 startingTime 으로 주면 온다 (10초 단위).
const LOL_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z"; // lolesports.com 사이트가 쓰는 공개 키 (collector 와 같음)
async function fetchLol(fetcher: Fetcher, matchId: string, startAt: string | null, now: Date): Promise<BoxScore | null> {
  const details = await getJson<{ data?: { event?: LolEventDetails } }>(
    fetcher,
    `https://esports-api.lolesports.com/persisted/gw/getEventDetails?hl=en-US&id=${encodeURIComponent(matchId)}`,
    { "x-api-key": LOL_KEY },
  );
  const event = details.data?.event;
  if (!event?.match?.games?.length) return null;
  const start = startAt ? new Date(startAt).getTime() : now.getTime();
  const at = Math.min(now.getTime() - 60_000, start + 10 * 3600_000);
  const startingTime = new Date(Math.floor(at / 10_000) * 10_000).toISOString();
  const windows = new Map<number, LolWindow>();
  for (const g of event.match.games.filter((x) => x.state === "completed")) {
    const w = await getJson<LolWindow>(
      fetcher,
      `https://feed.lolesports.com/livestats/v1/window/${encodeURIComponent(g.id)}?startingTime=${startingTime}`,
    ).catch(() => null);
    if (w?.frames?.length) windows.set(g.number, w);
  }
  if (!windows.size) return null;
  return parseLol(event, windows);
}

const F1_PATH: Record<F1Kind, string> = { race: "results", sprint: "sprint", quali: "qualifying" };
async function fetchF1(fetcher: Fetcher, r: { season: string; round: string; kind: F1Kind }) {
  const json = await getJson<{ MRData: { RaceTable: { Races: JolpicaRaceResult[] } } }>(
    fetcher,
    `https://api.jolpi.ca/ergast/f1/${r.season}/${r.round}/${F1_PATH[r.kind]}/?limit=100`,
  );
  const race = json.MRData.RaceTable.Races[0];
  return race ? parseF1(r.kind, race) : null;
}
