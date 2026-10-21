import type { Db } from "./db";

// 사이트(서버)와 화면(클라이언트)이 함께 쓰는 응답 타입

export const MAX_TEAMS = 10;

export interface CatalogTeam {
  slug: string;
  nameKo: string;
  shortKo: string;
  sport: string;
  competition: string | null;
}

export interface CatalogCompetition {
  slug: string;
  nameKo: string;
  sport: string;
  type: string;
  lastSuccessAt: string | null;
  lastSource: string | null;
}

export interface Catalog {
  sports: { slug: string; nameKo: string }[];
  competitions: CatalogCompetition[];
  teams: CatalogTeam[];
}

export interface ScheduleMatch {
  id: string;
  competition: string;
  roundLabel: string | null;
  home: string | null; // team slug
  away: string | null;
  homeLabel: string;
  awayLabel: string;
  startAt: string | null;
  dateOnly: string | null;
  status: "scheduled" | "time_tbd" | "conditional" | "draw_pending" | "postponed" | "cancelled";
  venue: string | null;
  isNeutral: boolean;
}

export async function getCatalog(db: Db): Promise<Catalog> {
  const [sports, competitions, teams] = await Promise.all([
    db.query<{ slug: string; name_ko: string }>(
      "select slug, name_ko from sport where exists (select 1 from team where team.sport_id = sport.id) order by id",
    ),
    db.query<{
      slug: string;
      name_ko: string;
      sport: string;
      type: string;
      last_success_at: Date | null;
      last_source: string | null;
    }>(
      `select c.slug, c.name_ko, s.slug as sport, c.type, st.last_success_at, st.last_source
       from competition c join sport s on s.id = c.sport_id
       left join competition_status st on st.competition_id = c.id
       order by c.id`,
    ),
    db.query<{ slug: string; name_ko: string; short_ko: string | null; sport: string; competition: string | null }>(
      `select t.slug, t.name_ko, t.short_ko, s.slug as sport, c.slug as competition
       from team t join sport s on s.id = t.sport_id
       left join competition c on c.id = t.primary_competition_id
       order by t.name_ko`,
    ),
  ]);
  return {
    sports: sports.map((s) => ({ slug: s.slug, nameKo: s.name_ko })),
    competitions: competitions.map((c) => ({
      slug: c.slug,
      nameKo: c.name_ko,
      sport: c.sport,
      type: c.type,
      lastSuccessAt: c.last_success_at?.toISOString() ?? null,
      lastSource: c.last_source,
    })),
    teams: teams.map((t) => ({
      slug: t.slug,
      nameKo: t.name_ko,
      shortKo: t.short_ko ?? t.name_ko,
      sport: t.sport,
      competition: t.competition,
    })),
  };
}

// 선택한 팀들의 경기. 지난 경기는 두 달 전까지만 (달력에서 지난 달을 볼 수 있도록)
export async function getMatchesForTeams(db: Db, teamSlugs: string[]): Promise<ScheduleMatch[]> {
  if (teamSlugs.length === 0) return [];
  const rows = await db.query<{
    id: string;
    competition: string;
    round_label: string | null;
    home: string | null;
    away: string | null;
    home_label: string | null;
    away_label: string | null;
    start_at: Date | null;
    date_only: string | Date | null;
    status: ScheduleMatch["status"];
    venue: string | null;
    is_neutral: boolean;
  }>(
    `select m.id, c.slug as competition, m.round_label, h.slug as home, a.slug as away,
       coalesce(h.short_ko, h.name_ko, m.home_placeholder) as home_label,
       coalesce(a.short_ko, a.name_ko, m.away_placeholder) as away_label,
       m.start_at, to_char(m.date_only, 'YYYY-MM-DD') as date_only, m.status, m.venue, m.is_neutral
     from match m
     join competition c on c.id = m.competition_id
     left join team h on h.id = m.home_team_id
     left join team a on a.id = m.away_team_id
     where (h.slug = any(string_to_array($1, ',')) or a.slug = any(string_to_array($1, ',')))
       and coalesce(m.start_at, m.date_only::timestamptz) >= now() - interval '62 days'
     order by coalesce(m.start_at, m.date_only::timestamptz)`,
    [teamSlugs.join(",")],
  );
  return rows.map((r) => ({
    id: r.id,
    competition: r.competition,
    roundLabel: r.round_label,
    home: r.home,
    away: r.away,
    homeLabel: r.home_label ?? "미정",
    awayLabel: r.away_label ?? "미정",
    startAt: r.start_at?.toISOString() ?? null,
    dateOnly: typeof r.date_only === "string" ? r.date_only : null,
    status: r.status,
    venue: r.venue,
    isNeutral: r.is_neutral,
  }));
}
