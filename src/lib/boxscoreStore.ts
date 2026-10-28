import type { Db } from "@/lib/db";
import type { Fetcher } from "@/collector/types";
import { getJson } from "@/collector/sources/http";
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
} from "@/lib/boxscore";

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
    data: BoxScore | null;
    fetched_at: Date | string | null;
  }>(
    `select c.slug as competition, m.start_at, m.home_team_id, m.away_team_id, m.home_score, b.data, b.fetched_at
     from match m join competition c on c.id = m.competition_id
     left join boxscore b on b.match_id = m.id
     where m.id = $1`,
    [matchId],
  );
  if (!row || row.home_score == null || !BOX_COMPETITIONS.has(row.competition)) return null;

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
