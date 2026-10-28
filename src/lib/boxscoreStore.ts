import type { Db } from "@/lib/db";
import type { Fetcher } from "@/collector/types";
import { getJson } from "@/collector/sources/http";
import {
  BOX_COMPETITIONS,
  parseEspn,
  parseMlb,
  parseNhl,
  type BoxScore,
  type EspnSummary,
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
    home_score: number | null;
    data: BoxScore | null;
    fetched_at: Date | string | null;
  }>(
    `select c.slug as competition, m.start_at, m.home_score, b.data, b.fetched_at
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
  const ref = (source: string) => refs.find((r) => r.source === source)?.external_id;

  let box: BoxScore | null = null;
  try {
    box = await fetchBox(fetcher, row.competition, ref, paths[0]?.external_id);
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

async function fetchBox(
  fetcher: Fetcher,
  competition: string,
  ref: (source: string) => string | undefined,
  espnPath: string | undefined,
): Promise<BoxScore | null> {
  const mlb = ref("mlb");
  if (competition === "mlb" && mlb) {
    const box = await getJson<MlbBox>(fetcher, `https://statsapi.mlb.com/api/v1/game/${mlb}/boxscore`);
    const ls = await getJson<MlbLinescore>(fetcher, `https://statsapi.mlb.com/api/v1/game/${mlb}/linescore`).catch(() => null);
    return parseMlb(box, ls);
  }
  const nhl = ref("nhl");
  if (competition === "nhl" && nhl) {
    const box = await getJson<NhlBox>(fetcher, `https://api-web.nhle.com/v1/gamecenter/${nhl}/boxscore`);
    const rail = await getJson<NhlRail>(fetcher, `https://api-web.nhle.com/v1/gamecenter/${nhl}/right-rail`).catch(() => null);
    return parseNhl(box, rail);
  }
  const espn = ref("espn");
  if (espn && espnPath) {
    const json = await getJson<EspnSummary>(fetcher, `${ESPN}/${espnPath}/summary?event=${espn}`);
    return json.boxscore ? parseEspn(json, espnPath) : null;
  }
  return null;
}
