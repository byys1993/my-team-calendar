import { INTL_LOCALE, type Locale } from "@/i18n/config";
import type { Podium } from "@/collector/types";
import { f1Pick, isMinorF1Session, pickResults } from "./f1picks";
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
  lastSyncAt?: string | null; // 마지막으로 수집이 돈 시각 (갱신할 대회가 없어도 확인한 시각)
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
  venueCity?: string | null; // 경기장 도시 (홈팀 경기장으로 채운 경우만)
  isNeutral: boolean;
  podium: Podium[] | null; // F1 결과 (결승·스프린트 1~3위, 예선 폴 포지션)
  mine?: Podium[]; // F1: 고른 팀·드라이버의 순위 줄 (내 팀 경기 조회에서만)
  homeScore: number | null; // 끝난 경기 결과 (e스포츠는 세트 승수)
  awayScore: number | null;
  homePen?: number | null; // 승부차기 점수 (승부차기로 끝난 경기만)
  awayPen?: number | null;
  extra?: string | null; // 'ot' · 'ot:2' · 'so' · 'inn:12' (연장·슛아웃)
  broadcast: string | null; // 국내 중계 ('SPOTV, TVING'): 경기별 채널 + 대회 기본 플랫폼
  sequence: number; // 일정이 바뀔 때마다 +1 (ICS)
  updatedAt: string;
}

// 경기별 채널 뒤에 대회 기본 플랫폼을 붙인다 (중복 제외)
export function mergeBroadcast(...lists: (string | null)[]): string | null {
  const names = [...new Set(lists.flatMap((l) => (l ? l.split(",").map((s) => s.trim()) : [])).filter(Boolean))];
  return names.length ? names.join(", ") : null;
}

// 대회·종목 이름: 한국어면 name_ko, 아니면 그 언어 → 영어 → 한국어 순서로
const localName = (table: string) =>
  `case when $1 = 'ko' then ${table}.name_ko else coalesce(${table}.name_i18n->>$1, ${table}.name_i18n->>'en', ${table}.name_ko) end`;

export async function getCatalog(db: Db, locale: Locale): Promise<Catalog> {
  const ko = locale === "ko";
  // 조회는 하나씩 차례로 (한 연결에 동시에 보내면 Supabase 풀러에서 멈춘다)
  const [sports, competitions, teams] = [
    await db.query<{ slug: string; name: string }>(
      `select s.slug, ${localName("s")} as name from sport s
       where exists (select 1 from team where team.sport_id = s.id) order by s.id`,
      [locale],
    ),
    await db.query<{
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
    await db.query<{ slug: string; name_ko: string; short_ko: string | null; name_en: string; sport: string; competition: string | null }>(
      `select t.slug, t.name_ko, t.short_ko, t.name_en, s.slug as sport, c.slug as competition
       from team t join sport s on s.id = t.sport_id
       join competition c on c.id = coalesce(t.current_competition_id, t.primary_competition_id)
       where not t.needs_review`,
    ),
  ];
  const [beat] = await db.query<{ ran_at: Date }>("select ran_at from sync_heartbeat where id = 1");
  const collator = new Intl.Collator(INTL_LOCALE[locale]);
  return {
    lastSyncAt: beat?.ran_at.toISOString() ?? null,
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

interface MatchRowDb {
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
  venue_city: string | null;
  is_neutral: boolean;
  sequence: number;
  updated_at: Date;
  broadcast: string | null;
  comp_broadcast: string | null;
  home_score: number | null;
  away_score: number | null;
  home_pen: number | null;
  away_pen: number | null;
  extra: string | null;
  podium: Podium[] | null;
  results: Podium[] | null;
}

// 경기 목록 공통 조회 (리그 페이지도 쓴다). $1 = 언어, where 는 $2 부터 쓰는 조건
// picks: F1 팀·드라이버 slug 를 주면 그 순위 줄만 mine 으로 붙인다 (전체 순위는 보내지 않는다)
export async function queryMatches(
  db: Db,
  locale: Locale,
  where: string,
  params: unknown[],
  picks: string[] = [],
): Promise<ScheduleMatch[]> {
  const rows = await db.query<MatchRowDb>(
    `select m.id, c.slug as competition, s.slug as sport, m.round_label, m.title, h.slug as home, a.slug as away,
       case when $1 = 'ko' then coalesce(h.short_ko, h.name_ko, m.home_placeholder)
            else coalesce(h.name_en, m.home_placeholder) end as home_label,
       case when $1 = 'ko' then coalesce(a.short_ko, a.name_ko, m.away_placeholder)
            else coalesce(a.name_en, m.away_placeholder) end as away_label,
       m.start_at, to_char(m.date_only, 'YYYY-MM-DD') as date_only, m.status,
       -- 출처가 경기장을 안 주면(유럽 축구) 홈팀 경기장. 중립 경기·결승은 제외
       coalesce(m.venue, case when not m.is_neutral and m.round_label is distinct from '@stage:final' then h.venue end) as venue,
       case when m.venue is null and not m.is_neutral and m.round_label is distinct from '@stage:final' then h.venue_city end as venue_city,
       m.is_neutral, m.sequence, m.updated_at,
       m.broadcast, c.broadcast as comp_broadcast, m.home_score, m.away_score, m.home_pen, m.away_pen, m.extra, m.podium,
       m.results
     from match m
     join competition c on c.id = m.competition_id
     join sport s on s.id = c.sport_id
     left join team h on h.id = m.home_team_id
     left join team a on a.id = m.away_team_id
     where ${where}
     order by coalesce(m.start_at, m.date_only::timestamptz)`,
    [locale, ...params],
  );
  return rows.map((r) => ({
    id: r.id,
    competition: r.competition,
    sport: r.sport,
    // ESPN 은 승부차기 경기의 라운드 자리에 "X win 5-3 on penalties" 를 준다 → 결과로 따로 보여 주므로 감춘다
    roundLabel: r.home_pen != null && /penalt/i.test(r.round_label ?? "") ? null : r.round_label,
    title: r.title,
    home: r.home,
    away: r.away,
    homeLabel: r.home_label ?? "@tbd",
    awayLabel: r.away_label ?? "@tbd",
    startAt: r.start_at?.toISOString() ?? null,
    dateOnly: typeof r.date_only === "string" ? r.date_only : null,
    status: r.status,
    venue: r.venue,
    venueCity: r.venue_city,
    isNeutral: r.is_neutral,
    podium: r.podium,
    ...(picks.length && r.results
      ? { mine: [...new Map(picks.flatMap((p) => pickResults(r.results, p)).map((x) => [x.pos, x])).values()].sort((a, b) => a.pos - b.pos) }
      : {}),
    homeScore: r.home_score,
    awayScore: r.away_score,
    homePen: r.home_pen,
    awayPen: r.away_pen,
    extra: r.extra,
    broadcast: mergeBroadcast(r.broadcast, r.comp_broadcast),
    sequence: r.sequence,
    updatedAt: r.updated_at.toISOString(),
  }));
}

// 선택한 팀들의 경기. 지난 경기는 두 달 전까지만 (달력에서 지난 달을 볼 수 있도록)
// F1 팀·드라이버를 고르면 F1 의 모든 세션 (어느 팀·드라이버든 모든 세션에 나온다). f1MainOnly 면 결승·예선·스프린트만
export async function getMatchesForTeams(
  db: Db,
  teamSlugs: string[],
  locale: Locale,
  opts: { f1MainOnly?: boolean } = {},
): Promise<ScheduleMatch[]> {
  if (teamSlugs.length === 0) return [];
  const picks = teamSlugs.filter((s) => f1Pick(s));
  const rows = await queryMatches(
    db,
    locale,
    `(h.slug = any(string_to_array($2, ',')) or a.slug = any(string_to_array($2, ',')) or (c.slug = 'f1' and $3::boolean))
       and coalesce(m.start_at, m.date_only::timestamptz) >= now() - interval '62 days'`,
    [teamSlugs.join(","), picks.length > 0],
    picks,
  );
  return opts.f1MainOnly ? rows.filter((m) => !isMinorF1Session(m)) : rows;
}

// 날짜 패널의 '같은 리그 다른 경기'에서 빼는 종목. 이벤트형(F1)은 팀·드라이버 선택 방식으로 따로 보여 준다
export const NO_DAY_LIST_SPORTS = ["motorsport"];

// API 로 받은 시간대 이름이 올바른지 ('Asia/Seoul')
export function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// 그 순간이 tz 에서 며칠인지 'YYYY-MM-DD' (서버용, 화면 쪽 toDateKey 와 같은 방식)
const dayKey = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz }).format(new Date(iso));

// 여러 대회의 그날(tz 기준 dateKey) 경기 (날짜 패널의 '같은 리그 다른 경기'). F1 같은 이벤트형 종목은 뺀다
export async function getCompetitionsDay(
  db: Db,
  competitions: string[],
  dateKey: string,
  tz: string,
  locale: Locale,
): Promise<ScheduleMatch[]> {
  if (competitions.length === 0) return [];
  // 시간대 차이(최대 ±14시간)를 넉넉히 덮도록 앞뒤 하루를 더 받아 그 시간대 날짜로 거른다
  const day = new Date(`${dateKey}T00:00:00Z`).getTime();
  const rows = await queryMatches(
    db,
    locale,
    `c.slug = any(string_to_array($2, ',')) and s.slug <> all(string_to_array($3, ','))
       and coalesce(m.start_at, m.date_only::timestamptz) >= $4 and coalesce(m.start_at, m.date_only::timestamptz) < $5`,
    [
      competitions.join(","),
      NO_DAY_LIST_SPORTS.join(","),
      new Date(day - 86_400_000).toISOString(),
      new Date(day + 2 * 86_400_000).toISOString(),
    ],
  );
  return rows.filter((m) => m.status !== "cancelled" && (m.startAt ? dayKey(m.startAt, tz) : m.dateOnly) === dateKey);
}

// 한 대회의 한 달(tz 기준 'YYYY-MM') 경기 (리그 일정 탭의 달력)
export async function getCompetitionMonth(db: Db, competition: string, month: string, tz: string, locale: Locale): Promise<ScheduleMatch[]> {
  const [y, m] = month.split("-").map(Number);
  // 시간대 차이를 덮도록 앞뒤 하루를 더 받아 그 시간대 날짜로 거른다
  const from = Date.UTC(y, m - 1, 1) - 86_400_000;
  const to = Date.UTC(y, m, 1) + 86_400_000;
  const rows = await queryMatches(
    db,
    locale,
    `c.slug = $2 and coalesce(m.start_at, m.date_only::timestamptz) >= $3 and coalesce(m.start_at, m.date_only::timestamptz) < $4`,
    [competition, new Date(from).toISOString(), new Date(to).toISOString()],
  );
  return rows.filter((x) => x.status !== "cancelled" && (x.startAt ? dayKey(x.startAt, tz) : (x.dateOnly ?? "")).startsWith(`${month}-`));
}

// 이 대회들 중 앞으로 남은 경기(대진 미정 포함)가 있는 대회 (예정 경기가 없는 팀 카드: '시즌 종료' 대신 '진행 중')
export async function getOngoingCompetitions(db: Db, competitions: string[]): Promise<string[]> {
  if (competitions.length === 0) return [];
  const rows = await db.query<{ slug: string }>(
    `select distinct c.slug from match m join competition c on c.id = m.competition_id
     where c.slug = any(string_to_array($1, ',')) and m.status <> 'cancelled'
       and coalesce(m.start_at, m.date_only::timestamptz) >= now() - interval '2 hours'`,
    [competitions.join(",")],
  );
  return rows.map((r) => r.slug).sort();
}
