import type { Locale } from "@/i18n/config";
import type { Db } from "@/lib/db";
import { F1_SERIES, f1Pick } from "@/lib/f1picks";
import {
  getCatalog,
  queryMatches,
  getMatchesForTeams,
  type CatalogCompetition,
  type CatalogTeam,
  type ScheduleMatch,
} from "@/lib/schedule";

// 검색으로 들어오는 팀·리그 페이지용 데이터. 화면은 서버에서 그려 검색엔진·AI 가 그대로 읽을 수 있다.

export interface StandingRow {
  rank: number;
  team: string | null;
  name: string;
  driverId?: string;
  sub?: string;
  stats: Record<string, number | string | null>;
}
export interface StandingTable {
  kind: "teams" | "drivers" | "constructors" | "leaders";
  season: string | null;
  updatedAt: string;
  groups: { name: string | null; rows: StandingRow[] }[];
}

async function standingTables(db: Db, competition: string): Promise<StandingTable[]> {
  const rows = await db.query<{ kind: StandingTable["kind"]; season: string | null; updated_at: Date; groups: StandingTable["groups"] }>(
    `select st.kind, st.season, st.updated_at, st.groups from standing st
     join competition c on c.id = st.competition_id where c.slug = $1
     order by case st.kind when 'teams' then 0 when 'drivers' then 1 when 'constructors' then 2 else 3 end`,
    [competition],
  );
  return rows.map((r) => ({ kind: r.kind, season: r.season, updatedAt: r.updated_at.toISOString(), groups: r.groups }));
}

// 이미 시작한 지 2시간이 안 된 경기는 '다가오는 경기'에 남긴다
const LIVE_MS = 2 * 3600_000;
const startMs = (m: ScheduleMatch) => (m.startAt ? new Date(m.startAt).getTime() : new Date(`${m.dateOnly}T23:59:00+09:00`).getTime());

export interface TeamPageData {
  team: CatalogTeam;
  competition: CatalogCompetition | null;
  upcoming: ScheduleMatch[];
  recent: ScheduleMatch[];
  standing: { rank: number; group: string | null; size: number; stats: StandingRow["stats"] } | null;
  leagueTeams: CatalogTeam[];
}

export async function getTeamPage(db: Db, slug: string, locale: Locale, now = new Date()): Promise<TeamPageData | null> {
  const catalog = await getCatalog(db, locale);
  const team = catalog.teams.find((t) => t.slug === slug);
  if (!team) return null;
  const competition = catalog.competitions.find((c) => c.slug === team.competition) ?? null;
  const matches = (await getMatchesForTeams(db, [slug], locale)).filter((m) => m.status !== "cancelled");
  const t = now.getTime();
  const upcoming = matches.filter((m) => startMs(m) >= t - LIVE_MS).slice(0, 12);
  const recent = matches
    .filter((m) => startMs(m) < t - LIVE_MS)
    .reverse()
    .slice(0, 8);
  let standing: TeamPageData["standing"] = null;
  if (competition) {
    // F1 팀·드라이버는 컨스트럭터·드라이버 순위에서 찾는다
    const pick = f1Pick(slug);
    const kind = pick ? (pick.kind === "team" ? "constructors" : "drivers") : "teams";
    const isMine = (r: StandingRow) => (pick ? pick.match.includes(pick.kind === "team" ? r.name : (r.driverId ?? "")) : r.team === slug);
    const table = (await standingTables(db, competition.slug)).find((x) => x.kind === kind);
    for (const g of table?.groups ?? []) {
      const row = g.rows.find(isMine);
      if (row) standing = { rank: row.rank, group: g.name, size: g.rows.length, stats: row.stats };
    }
  }
  const leagueTeams = catalog.teams.filter((x) => x.competition === team.competition && x.slug !== slug && x.slug !== F1_SERIES);
  return { team, competition, upcoming, recent, standing, leagueTeams };
}

// 리그 페이지 경기 목록의 이동: 축구는 라운드(@md:N, K리그 @round:N), 라운드가 없는 대회(컵 등)와 다른 종목은 7일씩
export type LeagueNav =
  | { mode: "round"; round: number; prev: string | null; next: string | null; isDefault: boolean }
  | { mode: "week"; from: string; to: string; prev: string | null; next: string | null; isDefault: boolean };

export interface LeagueNavQuery {
  round?: number;
  from?: string; // 'YYYY-MM-DD' (한국 날짜)
}

export interface LeaguePageData {
  competition: CatalogCompetition;
  week: ScheduleMatch[]; // 지금 보는 라운드·기간의 경기
  nav: LeagueNav;
  tables: StandingTable[];
  teams: CatalogTeam[];
  teamName: Record<string, string>;
}

// 페이지의 날짜는 한국 시간 기준 (한국은 서머타임이 없어 +09:00 고정)
const KST_MS = 9 * 3600_000;
const DAY_MS = 86_400_000;
const kstDate = (ms: number) => new Date(ms + KST_MS).toISOString().slice(0, 10);
const kstStart = (key: string) => new Date(`${key}T00:00:00+09:00`).getTime();
const addDays = (key: string, n: number) => kstDate(kstStart(key) + n * DAY_MS);
const WHEN = "coalesce(m.start_at, m.date_only::timestamptz)";
// 라운드 번호 토큰 ('@md:9', '@stage:league|@md:3', '@stage:kl_final_a|@round:34')
const ROUND_RE = "(^|\\|)@(md|round):[0-9]+";
const ROUND_NUM = "substring(m.round_label from '@(?:md|round):([0-9]+)')::int";

export const isLeagueQueryValid = (q: LeagueNavQuery) =>
  (q.round == null || (Number.isInteger(q.round) && q.round > 0 && q.round < 1000)) &&
  (q.from == null || (/^\d{4}-\d{2}-\d{2}$/.test(q.from) && kstDate(kstStart(q.from)) === q.from));

interface RoundInfo {
  n: number;
  last: number; // 그 라운드 경기 대부분(90%)이 시작한 시각. 연기된 한두 경기 때문에 지난 라운드가 남지 않도록
  end: number; // 마지막 경기 시각
}

// 축구 대회의 가장 최근 시즌 라운드 목록 (라운드 토큰이 없으면 null)
async function seasonRounds(db: Db, slug: string): Promise<{ season: string; rounds: RoundInfo[] } | null> {
  const [s] = await db.query<{ season: string | null }>(
    `select max(m.season) as season from match m join competition c on c.id = m.competition_id
     where c.slug = $1 and m.round_label ~ '${ROUND_RE}'`,
    [slug],
  );
  if (!s?.season) return null;
  const rows = await db.query<{ n: number; last: number; end: number }>(
    `select ${ROUND_NUM} as n,
       percentile_disc(0.9) within group (order by extract(epoch from ${WHEN})) as last,
       max(extract(epoch from ${WHEN})) as "end"
     from match m join competition c on c.id = m.competition_id
     where c.slug = $1 and m.season = $2 and m.round_label ~ '${ROUND_RE}' and m.status <> 'cancelled'
     group by 1 order by 1`,
    [slug, s.season],
  );
  return { season: s.season, rounds: rows.map((r) => ({ n: Number(r.n), last: Number(r.last) * 1000, end: Number(r.end) * 1000 })) };
}

// 이 시각 앞(before) 또는 뒤의 가장 가까운 경기 시각
async function nearestMatch(db: Db, slug: string, at: number, before: boolean): Promise<number | null> {
  const [r] = await db.query<{ t: number | null }>(
    `select ${before ? "max" : "min"}(extract(epoch from ${WHEN})) as t from match m join competition c on c.id = m.competition_id
     where c.slug = $1 and m.status <> 'cancelled' and ${WHEN} ${before ? "<" : ">="} $2`,
    [slug, new Date(at).toISOString()],
  );
  return r?.t == null ? null : Number(r.t) * 1000;
}

async function leagueMatches(
  db: Db,
  competition: CatalogCompetition,
  locale: Locale,
  q: LeagueNavQuery,
  now: Date,
): Promise<{ matches: ScheduleMatch[]; nav: LeagueNav }> {
  const slug = competition.slug;
  const t = now.getTime();
  const live = (list: ScheduleMatch[]) => list.filter((m) => m.status !== "cancelled");
  const season = competition.sport === "soccer" && q.from == null ? await seasonRounds(db, slug) : null;
  if (season?.rounds.length) {
    const { rounds } = season;
    let i = q.round != null ? rounds.findIndex((r) => r.n === q.round) : -1;
    const isDefault = q.round == null || i < 0;
    if (isDefault) {
      // 기본: 아직 끝나지 않은 첫 라운드. 모두 끝났는데 뒤에 다른 경기(컵 토너먼트 등)가 있으면 7일 보기로
      i = rounds.findIndex((r) => r.last >= t - LIVE_MS);
      if (i < 0 && (await nearestMatch(db, slug, rounds[rounds.length - 1].end + 1000, false)) != null) i = -2;
      else if (i < 0) i = rounds.length - 1;
    }
    if (i >= 0) {
      const r = rounds[i];
      const matches = live(
        await queryMatches(db, locale, `c.slug = $2 and m.season = $3 and ${ROUND_NUM} = $4`, [slug, season.season, r.n]),
      );
      // 마지막 라운드 다음에 경기가 더 있으면(토너먼트) 그다음 날부터 7일 보기로 넘어간다
      const after = i === rounds.length - 1 ? await nearestMatch(db, slug, r.end + 1000, false) : null;
      return {
        matches,
        nav: {
          mode: "round",
          round: r.n,
          prev: i > 0 ? `?round=${rounds[i - 1].n}` : null,
          next: i < rounds.length - 1 ? `?round=${rounds[i + 1].n}` : after != null ? `?from=${kstDate(after)}` : null,
          isDefault,
        },
      };
    }
  }
  const from = q.from ?? kstDate(t);
  const start = kstStart(from);
  const end = start + 7 * DAY_MS;
  const matches = live(
    await queryMatches(db, locale, `c.slug = $2 and ${WHEN} >= $3 and ${WHEN} < $4`, [
      slug,
      new Date(start).toISOString(),
      new Date(end).toISOString(),
    ]),
  );
  // 경기가 없는 기간(휴식기·비시즌)은 건너뛰고 가장 가까운 경기가 있는 7일로 간다
  const before = await nearestMatch(db, slug, start, true);
  const after = await nearestMatch(db, slug, end, false);
  return {
    matches,
    nav: {
      mode: "week",
      from,
      to: addDays(from, 6),
      prev: before == null ? null : `?from=${before >= start - 7 * DAY_MS ? addDays(from, -7) : addDays(kstDate(before), -6)}`,
      next: after == null ? null : `?from=${after < end + 7 * DAY_MS ? addDays(from, 7) : kstDate(after)}`,
      isDefault: q.from == null,
    },
  };
}

export async function getLeaguePage(
  db: Db,
  slug: string,
  locale: Locale,
  now = new Date(),
  q: LeagueNavQuery = {},
): Promise<LeaguePageData | null> {
  const catalog = await getCatalog(db, locale);
  const competition = catalog.competitions.find((c) => c.slug === slug);
  if (!competition) return null;
  const { matches, nav } = await leagueMatches(db, competition, locale, isLeagueQueryValid(q) ? q : {}, now);
  return {
    competition,
    week: matches,
    nav,
    tables: await standingTables(db, slug),
    teams: catalog.teams.filter((t) => t.competition === slug && t.slug !== F1_SERIES),
    teamName: Object.fromEntries(catalog.teams.map((t) => [t.slug, t.name])),
  };
}

// 사이트맵용: 팀 선택 목록에 나오는 모든 팀(F1 시리즈 제외)과 모든 대회
export async function sitemapEntries(db: Db): Promise<{ teams: string[]; leagues: string[] }> {
  const catalog = await getCatalog(db, "ko");
  return { teams: catalog.teams.filter((t) => t.slug !== F1_SERIES).map((t) => t.slug), leagues: catalog.competitions.map((c) => c.slug) };
}
