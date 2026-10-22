import { INTL_LOCALE, type Locale } from "@/i18n/config";
import type { Db } from "./db";

// 사이트(서버)와 화면(클라이언트)이 함께 쓰는 응답 타입.
// 이름은 요청한 언어로 내려준다: 한국어는 name_ko, 그 외 언어는 대회·종목은 name_i18n, 팀은 영문명(name_en).

export const MAX_TEAMS = 10;

export interface CatalogTeam {
  slug: string;
  name: string;
  short: string;
  sport: string;
  competition: string | null;
}

export interface CatalogCompetition {
  slug: string;
  name: string;
  sport: string;
  type: string;
  lastSuccessAt: string | null;
  lastSource: string | null;
}

export interface Catalog {
  sports: { slug: string; name: string }[];
  competitions: CatalogCompetition[];
  teams: CatalogTeam[];
}

export interface ScheduleMatch {
  id: string;
  competition: string;
  sport: string;
  roundLabel: string | null;
  title: string | null; // 이벤트형(F1 등) 제목 토큰 '@f1:Australian Grand Prix:race'
  home: string | null; // team slug
  away: string | null;
  homeLabel: string; // 팀 이름 또는 미정 표시('@tbd' 토큰일 수 있음)
  awayLabel: string;
  startAt: string | null;
  dateOnly: string | null;
  status: "scheduled" | "time_tbd" | "conditional" | "draw_pending" | "postponed" | "cancelled";
  venue: string | null;
  isNeutral: boolean;
}

// 대회·종목 이름: 한국어면 name_ko, 아니면 그 언어 → 영어 → 한국어 순서로
const localName = (table: string) =>
  `case when $1 = 'ko' then ${table}.name_ko else coalesce(${table}.name_i18n->>$1, ${table}.name_i18n->>'en', ${table}.name_ko) end`;

export async function getCatalog(db: Db, locale: Locale): Promise<Catalog> {
  const ko = locale === "ko";
  const [sports, competitions, teams] = await Promise.all([
    db.query<{ slug: string; name: string }>(
      `select s.slug, ${localName("s")} as name from sport s
       where exists (select 1 from team where team.sport_id = s.id) order by s.id`,
      [locale],
    ),
    db.query<{
      slug: string;
      name: string;
      sport: string;
      type: string;
      last_success_at: Date | null;
      last_source: string | null;
    }>(
      `select c.slug, ${localName("c")} as name, s.slug as sport, c.type, st.last_success_at, st.last_source
       from competition c join sport s on s.id = c.sport_id
       left join competition_status st on st.competition_id = c.id
       order by c.display_order, c.id`,
      [locale],
    ),
    db.query<{ slug: string; name_ko: string; short_ko: string | null; name_en: string; sport: string; competition: string | null }>(
      `select t.slug, t.name_ko, t.short_ko, t.name_en, s.slug as sport, c.slug as competition
       from team t join sport s on s.id = t.sport_id
       join competition c on c.id = t.primary_competition_id`,
    ),
  ]);
  const collator = new Intl.Collator(INTL_LOCALE[locale]);
  return {
    sports: sports.map((s) => ({ slug: s.slug, name: s.name })),
    competitions: competitions.map((c) => ({
      slug: c.slug,
      name: c.name,
      sport: c.sport,
      type: c.type,
      lastSuccessAt: c.last_success_at?.toISOString() ?? null,
      lastSource: c.last_source,
    })),
    teams: teams
      .map((t) => ({
        slug: t.slug,
        name: ko ? t.name_ko : t.name_en,
        short: ko ? (t.short_ko ?? t.name_ko) : t.name_en,
        sport: t.sport,
        competition: t.competition,
      }))
      .sort((a, b) => collator.compare(a.name, b.name)),
  };
}

// 선택한 팀들의 경기. 지난 경기는 두 달 전까지만 (달력에서 지난 달을 볼 수 있도록)
export async function getMatchesForTeams(db: Db, teamSlugs: string[], locale: Locale): Promise<ScheduleMatch[]> {
  if (teamSlugs.length === 0) return [];
  const rows = await db.query<{
    id: string;
    competition: string;
    sport: string;
    round_label: string | null;
    title: string | null;
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
    `select m.id, c.slug as competition, s.slug as sport, m.round_label, m.title, h.slug as home, a.slug as away,
       case when $2 = 'ko' then coalesce(h.short_ko, h.name_ko, m.home_placeholder)
            else coalesce(h.name_en, m.home_placeholder) end as home_label,
       case when $2 = 'ko' then coalesce(a.short_ko, a.name_ko, m.away_placeholder)
            else coalesce(a.name_en, m.away_placeholder) end as away_label,
       m.start_at, to_char(m.date_only, 'YYYY-MM-DD') as date_only, m.status, m.venue, m.is_neutral
     from match m
     join competition c on c.id = m.competition_id
     join sport s on s.id = c.sport_id
     left join team h on h.id = m.home_team_id
     left join team a on a.id = m.away_team_id
     where (h.slug = any(string_to_array($1, ',')) or a.slug = any(string_to_array($1, ',')))
       and coalesce(m.start_at, m.date_only::timestamptz) >= now() - interval '62 days'
     order by coalesce(m.start_at, m.date_only::timestamptz)`,
    [teamSlugs.join(","), locale],
  );
  return rows.map((r) => ({
    id: r.id,
    competition: r.competition,
    sport: r.sport,
    roundLabel: r.round_label,
    title: r.title,
    home: r.home,
    away: r.away,
    homeLabel: r.home_label ?? "@tbd",
    awayLabel: r.away_label ?? "@tbd",
    startAt: r.start_at?.toISOString() ?? null,
    dateOnly: typeof r.date_only === "string" ? r.date_only : null,
    status: r.status,
    venue: r.venue,
    isNeutral: r.is_neutral,
  }));
}
