import type { MatchStatus } from "@/collector/types";
import type { Db } from "@/lib/db";
import { saveManualMatches, toSourceMatch, type ManualRow } from "./import";

// 관리자 화면에서 쓰는 수동 입력 경기(KBO·KBL) 조회·수정. 화면 입출력은 모두 한국 시간이다.

const kstDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const kstTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function toKst(d: Date): { date: string; time: string } {
  return { date: kstDate.format(d), time: kstTime.format(d) };
}

export interface AdminMatch {
  id: string;
  gameKey: string;
  league: string;
  date: string; // KST
  time: string | null; // KST, null = 시간 미정
  home: string | null;
  away: string | null;
  homeLabel: string;
  awayLabel: string;
  homePlaceholder: string | null;
  awayPlaceholder: string | null;
  status: MatchStatus;
  round: string | null;
  venue: string | null;
  sequence: number;
  updatedAt: Date;
}

interface Row {
  id: string;
  external_id: string;
  league: string;
  start_at: Date | null;
  date_only: string | null;
  status: MatchStatus;
  home: string | null;
  away: string | null;
  home_label: string | null;
  away_label: string | null;
  home_placeholder: string | null;
  away_placeholder: string | null;
  round_label: string | null;
  venue: string | null;
  sequence: number;
  updated_at: Date;
}

const SELECT = `
  select m.id, r.external_id, c.slug as league, m.start_at, to_char(m.date_only, 'YYYY-MM-DD') as date_only, m.status,
    h.slug as home, a.slug as away, h.name_ko as home_label, a.name_ko as away_label,
    m.home_placeholder, m.away_placeholder, m.round_label, m.venue, m.sequence, m.updated_at
  from match m
  join competition c on c.id = m.competition_id and c.feed = 'manual'
  join match_source_ref r on r.match_id = m.id and r.source = 'manual'
  left join team h on h.id = m.home_team_id
  left join team a on a.id = m.away_team_id`;

// 관리자 화면은 한국어 전용: 저장된 '@tbd' 토큰은 '미정'으로 보여준다
const placeholderKo = (p: string | null) => (p === "@tbd" ? "미정" : p);

function toAdmin(r: Row): AdminMatch {
  const kst = r.start_at ? toKst(r.start_at) : null;
  return {
    id: r.id,
    gameKey: r.external_id.slice(r.league.length + 1),
    league: r.league,
    date: kst?.date ?? r.date_only!,
    time: r.status === "time_tbd" || !kst ? null : kst.time,
    home: r.home,
    away: r.away,
    homeLabel: r.home_label ?? placeholderKo(r.home_placeholder) ?? "미정",
    awayLabel: r.away_label ?? placeholderKo(r.away_placeholder) ?? "미정",
    homePlaceholder: r.home_placeholder === "@tbd" ? null : r.home_placeholder,
    awayPlaceholder: r.away_placeholder === "@tbd" ? null : r.away_placeholder,
    status: r.status,
    round: r.round_label,
    venue: r.venue,
    sequence: r.sequence,
    updatedAt: r.updated_at,
  };
}

// month: 'YYYY-MM' (한국 시간 기준)
export async function listManualMatches(
  db: Db,
  league: string,
  month: string,
): Promise<AdminMatch[]> {
  const from = `${month}-01T00:00:00+09:00`;
  const rows = await db.query<Row>(
    `${SELECT}
     where c.slug = $1
       and coalesce(m.start_at, m.date_only::timestamp at time zone 'Asia/Seoul') >= $2::timestamptz
       and coalesce(m.start_at, m.date_only::timestamp at time zone 'Asia/Seoul') < $2::timestamptz + interval '1 month'
     order by coalesce(m.start_at, m.date_only::timestamp at time zone 'Asia/Seoul'), r.external_id`,
    [league, from],
  );
  return rows.map(toAdmin);
}

export async function getManualMatch(
  db: Db,
  id: string,
): Promise<AdminMatch | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.query<Row>(`${SELECT} where m.id = $1`, [id]);
  return row ? toAdmin(row) : null;
}

export async function manualKeyExists(
  db: Db,
  league: string,
  gameKey: string,
): Promise<boolean> {
  const rows = await db.query(
    "select 1 from match_source_ref where source = 'manual' and external_id = $1",
    [`${league}:${gameKey}`],
  );
  return rows.length > 0;
}

async function competitionId(db: Db, league: string): Promise<number> {
  const [c] = await db.query<{ id: number }>(
    "select id from competition where slug = $1 and feed = 'manual'",
    [league],
  );
  if (!c) throw new Error(`수동 입력 대회가 아닙니다: ${league}`);
  return c.id;
}

export async function createManualMatch(db: Db, row: ManualRow) {
  return saveManualMatches(db, await competitionId(db, row.league), [
    toSourceMatch(row),
  ]);
}

// 화면에서 고친 내용은 그대로 반영한다 (CSV 와 달리 빈 칸이면 장소·라운드도 지운다).
// 일정(날짜·시각·상태·장소·팀)이 바뀌면 sequence 를 올려 추후 ICS 구독에도 변경이 전달되게 한다.
export async function updateManualMatch(
  db: Db,
  id: string,
  row: ManualRow,
): Promise<void> {
  const before = await getManualMatch(db, id);
  if (!before) throw new Error("경기를 찾을 수 없습니다.");
  const m = toSourceMatch(row);
  const teamId = async (slug: string | null) =>
    slug
      ? ((
          await db.query<{ id: number }>(
            "select id from team where slug = $1",
            [slug],
          )
        )[0]?.id ?? null)
      : null;
  const scheduleChanged =
    before.date !== row.date ||
    before.time !== row.time ||
    before.status !== m.status ||
    (before.venue ?? null) !== row.venue ||
    before.home !== row.home ||
    before.away !== row.away;
  // 트랜잭션 안에서 다른 연결로 조회하면 (연결 1개 풀에서) 교착되므로 미리 구한다
  const homeId = await teamId(row.home);
  const awayId = await teamId(row.away);
  await db.tx(async (t) => {
    await t.query(
      `update match set start_at = $2, date_only = $3, status = $4, home_team_id = $5, away_team_id = $6,
         home_placeholder = $7, away_placeholder = $8, round_label = $9, venue = $10, season = $11,
         sequence = sequence + $12, updated_at = now()
       where id = $1`,
      [
        id,
        m.startAt,
        m.dateOnly ?? null,
        m.status,
        homeId,
        awayId,
        m.homePlaceholder ?? null,
        m.awayPlaceholder ?? null,
        row.round,
        row.venue,
        m.season,
        scheduleChanged ? 1 : 0,
      ],
    );
    await t.query(
      `update competition_status set last_success_at = now(), last_source = 'manual'
       where competition_id = (select competition_id from match where id = $1)`,
      [id],
    );
  });
}

export async function deleteManualMatch(db: Db, id: string): Promise<void> {
  const m = await getManualMatch(db, id);
  if (!m) throw new Error("경기를 찾을 수 없습니다.");
  await db.query("delete from match where id = $1", [id]);
}

export async function manualTeams(db: Db, league: string) {
  return db.query<{ slug: string; name_ko: string }>(
    `select t.slug, t.name_ko from team t join competition c on c.id = t.primary_competition_id
     where c.slug = $1 order by t.name_ko`,
    [league],
  );
}

// 자동 생성돼 한국어 이름이 필요한 팀
export async function reviewTeams(db: Db) {
  return db.query<{
    slug: string;
    name_ko: string;
    short_ko: string | null;
    name_en: string;
    competitions: string;
  }>(
    // 팀마다 경기 전체를 훑지 않도록 (팀, 대회) 쌍을 한 번에 모은 뒤 합친다
    `with appearances as (
       select home_team_id as team_id, competition_id from match where home_team_id is not null
       union
       select away_team_id, competition_id from match where away_team_id is not null
     )
     select t.slug, t.name_ko, t.short_ko, t.name_en,
       coalesce(string_agg(distinct c.name_ko, ', '), '') as competitions
     from team t
     left join appearances a on a.team_id = t.id
     left join competition c on c.id = a.competition_id
     where t.needs_review
     group by t.id
     order by t.name_en`,
  );
}

export async function updateTeamName(
  db: Db,
  slug: string,
  nameKo: string,
  shortKo: string | null,
): Promise<void> {
  await db.query(
    "update team set name_ko = $2, short_ko = $3, needs_review = false where slug = $1",
    [slug, nameKo, shortKo],
  );
}

// 관리자 첫 화면: 대회별 상태와 최근 수집 실패
export async function adminOverview(db: Db) {
  // 한 연결에 동시에 보내지 않고 차례로 조회한다 (풀러에서 멈추는 일 방지)
  const [competitions, failures, review] = [
    await db.query<{
      slug: string;
      name_ko: string;
      feed: string;
      matches: number;
      last_success_at: Date | null;
      last_source: string | null;
    }>(
      `select c.slug, c.name_ko, c.feed, (select count(*)::int from match m where m.competition_id = c.id) as matches,
         st.last_success_at, st.last_source
       from competition c left join competition_status st on st.competition_id = c.id
       order by c.display_order, c.id`,
    ),
    await db.query<{
      name_ko: string;
      source: string;
      started_at: Date;
      error: string | null;
      is_fallback: boolean;
    }>(
      `select c.name_ko, r.source, r.started_at, r.error, r.is_fallback
       from sync_run r join competition c on c.id = r.competition_id
       where not r.ok order by r.started_at desc limit 10`,
    ),
    await db.query<{ n: number }>(
      "select count(*)::int as n from team where needs_review",
    ),
  ];
  return { competitions, failures, reviewCount: review[0].n };
}
