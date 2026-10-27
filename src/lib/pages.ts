import type { Locale } from "@/i18n/config";
import type { Db } from "@/lib/db";
import {
  getCatalog,
  getMatchesForCompetition,
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
    const table = (await standingTables(db, competition.slug)).find((x) => x.kind === "teams");
    for (const g of table?.groups ?? []) {
      const row = g.rows.find((r) => r.team === slug);
      if (row) standing = { rank: row.rank, group: g.name, size: g.rows.length, stats: row.stats };
    }
  }
  const leagueTeams = catalog.teams.filter((x) => x.competition === team.competition && x.slug !== slug);
  return { team, competition, upcoming, recent, standing, leagueTeams };
}

export interface LeaguePageData {
  competition: CatalogCompetition;
  week: ScheduleMatch[];
  tables: StandingTable[];
  teams: CatalogTeam[];
  teamName: Record<string, string>;
}

export async function getLeaguePage(db: Db, slug: string, locale: Locale, now = new Date()): Promise<LeaguePageData | null> {
  const catalog = await getCatalog(db, locale);
  const competition = catalog.competitions.find((c) => c.slug === slug);
  if (!competition) return null;
  const week = (await getMatchesForCompetition(db, slug, locale, new Date(now.getTime() - LIVE_MS), new Date(now.getTime() + 7 * 86_400_000))).filter(
    (m) => m.status !== "cancelled",
  );
  return {
    competition,
    week,
    tables: await standingTables(db, slug),
    teams: catalog.teams.filter((t) => t.competition === slug),
    teamName: Object.fromEntries(catalog.teams.map((t) => [t.slug, t.name])),
  };
}

// 사이트맵용: 팀 선택 목록에 나오는 모든 팀과 모든 대회
export async function sitemapEntries(db: Db): Promise<{ teams: string[]; leagues: string[] }> {
  const catalog = await getCatalog(db, "ko");
  return { teams: catalog.teams.map((t) => t.slug), leagues: catalog.competitions.map((c) => c.slug) };
}
