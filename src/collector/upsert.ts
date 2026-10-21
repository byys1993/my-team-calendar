import type { Db } from "@/lib/db";
import { normalizeName } from "./normalize";
import type { SourceMatch, SourceTeam } from "./types";

export interface UpsertResult {
  inserted: number;
  updated: number;
  skipped: number;
  unmapped: string[];
}

interface MatchRow {
  id: string;
  season: string;
  round_label: string | null;
  title: string | null;
  home_team_id: number | null;
  away_team_id: number | null;
  home_placeholder: string | null;
  away_placeholder: string | null;
  start_at: Date | null;
  date_only: string | Date | null;
  status: string;
  venue: string | null;
  is_neutral: boolean;
}

// 대체 소스 경기와 기존 경기를 같은 경기로 볼 최대 시각 차이.
// 축구는 같은 대진이 시즌에 한 번뿐이라 연기 경기까지 넓게 보고,
// 같은 팀끼리 며칠 연속 붙는 미국 리그(시리즈)는 좁게 본다.
const CROSS_SOURCE_WINDOW_DAYS: Record<string, number> = { soccer: 120, default: 1.5 };
// 이벤트형(F1 세션)은 같은 주말의 다른 세션과 섞이지 않도록 2시간 이내만 같은 것으로 본다.
const EVENT_WINDOW_DAYS = 2 / 24;

class TeamResolver {
  private cache = new Map<string, number | null>();
  private byName?: Map<string, Set<number>>;

  constructor(
    private db: Db,
    private competitionId: number,
    private source: string,
    private autoCreate: boolean,
  ) {}

  async resolve(team: SourceTeam): Promise<number | null> {
    if (this.cache.has(team.externalId)) return this.cache.get(team.externalId)!;
    const [ref] = await this.db.query<{ team_id: number }>(
      "select team_id from team_source_ref where source = $1 and external_id = $2",
      [this.source, team.externalId],
    );
    const teamId =
      ref?.team_id ?? (await this.autoMatch(team)) ?? (this.autoCreate ? await this.create(team) : null);
    if (teamId == null) {
      await this.db.query(
        `insert into unmapped_team (source, external_id, raw_name, competition_id) values ($1, $2, $3, $4)
         on conflict (source, external_id) do update set raw_name = excluded.raw_name, last_seen_at = now()`,
        [this.source, team.externalId, team.name, this.competitionId],
      );
    }
    this.cache.set(team.externalId, teamId);
    return teamId;
  }

  // 이름이 정확히 한 팀과 일치하고, 그 팀이 이 소스에 아직 다른 ID로 연결되지 않았을 때만 자동 연결한다.
  private async autoMatch(team: SourceTeam): Promise<number | null> {
    if (!this.byName) {
      const rows = await this.db.query<{ id: number; name_en: string; aliases: string[] }>(
        `select t.id, t.name_en, t.aliases from team t
         where t.sport_id = (select sport_id from competition where id = $1)
           and not exists (select 1 from team_source_ref r where r.team_id = t.id and r.source = $2)`,
        [this.competitionId, this.source],
      );
      this.byName = new Map();
      for (const r of rows) {
        for (const n of [r.name_en, ...r.aliases]) {
          const key = normalizeName(n);
          if (!this.byName.has(key)) this.byName.set(key, new Set());
          this.byName.get(key)!.add(r.id);
        }
      }
    }
    const ids = new Set<number>();
    for (const n of [team.name, team.shortName]) {
      if (n) for (const id of this.byName.get(normalizeName(n)) ?? []) ids.add(id);
    }
    if (ids.size !== 1) return null;
    const [teamId] = ids;
    await this.db.query(
      `insert into team_source_ref (team_id, source, external_id, raw_name) values ($1, $2, $3, $4)
       on conflict do nothing`,
      [teamId, this.source, team.externalId, team.name],
    );
    for (const set of this.byName.values()) set.delete(teamId);
    return teamId;
  }

  // 시드에 없는 상대팀(컵대회 하부리그 팀 등)을 원문 이름으로 만든다. 팀 선택 목록에는 나오지 않고,
  // needs_review 로 표시해 나중에 한국어 이름을 채운다. 대체 소스에서는 중복 팀이 생길 수 있어 쓰지 않는다.
  private async create(team: SourceTeam): Promise<number> {
    const slug = `${this.source}-${team.externalId}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    const [{ id }] = await this.db.query<{ id: number }>(
      `insert into team (sport_id, slug, name_ko, short_ko, name_en, needs_review)
       values ((select sport_id from competition where id = $1), $2, $3, $4, $3, true)
       on conflict (slug) do update set name_en = excluded.name_en
       returning id`,
      [this.competitionId, slug, team.name, team.shortName ?? null],
    );
    await this.db.query(
      `insert into team_source_ref (team_id, source, external_id, raw_name) values ($1, $2, $3, $4)
       on conflict do nothing`,
      [id, this.source, team.externalId, team.name],
    );
    await this.db.query("delete from unmapped_team where source = $1 and external_id = $2", [
      this.source,
      team.externalId,
    ]);
    return id;
  }
}

function sameTime(a: Date | null, b: string | null): boolean {
  if (!a || !b) return a == null && b == null;
  return a.getTime() === new Date(b).getTime();
}

function sameDate(a: string | Date | null, b: string | null): boolean {
  const left = a instanceof Date ? a.toISOString().slice(0, 10) : a;
  return (left ?? null) === (b ?? null);
}

// 소스 경기 목록을 저장한다. 같은 경기는 기존 ID를 그대로 두고 내용만 갱신한다.
export async function upsertMatches(
  db: Db,
  competitionId: number,
  source: string,
  matches: SourceMatch[],
  opts: { autoCreateTeams?: boolean } = {},
): Promise<UpsertResult> {
  const result: UpsertResult = { inserted: 0, updated: 0, skipped: 0, unmapped: [] };
  const teams = new TeamResolver(db, competitionId, source, opts.autoCreateTeams ?? false);
  const [{ sport }] = await db.query<{ sport: string }>(
    "select s.slug as sport from competition c join sport s on s.id = c.sport_id where c.id = $1",
    [competitionId],
  );
  const windowDays = CROSS_SOURCE_WINDOW_DAYS[sport] ?? CROSS_SOURCE_WINDOW_DAYS.default;

  for (const m of matches) {
    if (!m.startAt && !m.dateOnly) {
      result.skipped++;
      continue;
    }
    const homeId = m.home ? await teams.resolve(m.home) : null;
    const awayId = m.away ? await teams.resolve(m.away) : null;
    // 실제 팀이 있는데 매핑에 실패하면 잘못된 경기가 생기지 않도록 저장하지 않는다.
    if ((m.home && homeId == null) || (m.away && awayId == null)) {
      for (const [t, id] of [[m.home, homeId], [m.away, awayId]] as const) {
        if (t && id == null && !result.unmapped.includes(t.name)) result.unmapped.push(t.name);
      }
      result.skipped++;
      continue;
    }

    const next = {
      season: m.season,
      round_label: m.roundLabel ?? null,
      title: m.title ?? null,
      home_team_id: homeId,
      away_team_id: awayId,
      home_placeholder: m.home ? null : (m.homePlaceholder ?? null),
      away_placeholder: m.away ? null : (m.awayPlaceholder ?? null),
      start_at: m.startAt,
      date_only: m.dateOnly ?? null,
      status: m.status,
      venue: m.venue ?? null,
      is_neutral: m.isNeutral ?? false,
    };

    const isEvent = homeId != null && !m.away && !!next.title;
    const existing = await findExisting(db, competitionId, source, m.externalId, homeId, awayId, m.startAt,
      isEvent ? EVENT_WINDOW_DAYS : windowDays, isEvent);
    if (!existing) {
      const [{ id }] = await db.query<{ id: string }>(
        `insert into match (competition_id, season, round_label, title, home_team_id, away_team_id, home_placeholder,
           away_placeholder, start_at, date_only, status, venue, is_neutral)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
        [competitionId, next.season, next.round_label, next.title, next.home_team_id, next.away_team_id,
          next.home_placeholder, next.away_placeholder, next.start_at, next.date_only, next.status, next.venue,
          next.is_neutral],
      );
      await linkSource(db, id, source, m.externalId);
      result.inserted++;
      continue;
    }

    const { row, linked } = existing;
    if (!linked) await linkSource(db, row.id, source, m.externalId);
    // 소스가 장소·라운드를 주지 않으면 기존 값을 지우지 않는다.
    const venue = next.venue ?? row.venue;
    const roundLabel = next.round_label ?? row.round_label;
    const title = next.title ?? row.title;
    const scheduleChanged =
      !sameTime(row.start_at, next.start_at) ||
      !sameDate(row.date_only, next.date_only) ||
      row.status !== next.status ||
      row.venue !== venue ||
      row.home_team_id !== next.home_team_id ||
      row.away_team_id !== next.away_team_id;
    const otherChanged =
      row.season !== next.season ||
      row.round_label !== roundLabel ||
      row.title !== title ||
      row.home_placeholder !== next.home_placeholder ||
      row.away_placeholder !== next.away_placeholder ||
      row.is_neutral !== next.is_neutral;
    if (!scheduleChanged && !otherChanged) continue;

    await db.query(
      `update match set season = $2, round_label = $3, home_team_id = $4, away_team_id = $5, home_placeholder = $6,
         away_placeholder = $7, start_at = $8, date_only = $9, status = $10, venue = $11, is_neutral = $12,
         sequence = sequence + $13, title = $14, updated_at = now()
       where id = $1`,
      [row.id, next.season, roundLabel, next.home_team_id, next.away_team_id, next.home_placeholder,
        next.away_placeholder, next.start_at, next.date_only, next.status, venue, next.is_neutral,
        scheduleChanged ? 1 : 0, title],
    );
    result.updated++;
  }
  return result;
}

async function linkSource(db: Db, matchId: string, source: string, externalId: string) {
  await db.query(
    "insert into match_source_ref (match_id, source, external_id) values ($1, $2, $3) on conflict do nothing",
    [matchId, source, externalId],
  );
}

async function findExisting(
  db: Db,
  competitionId: number,
  source: string,
  externalId: string,
  homeId: number | null,
  awayId: number | null,
  startAt: string | null,
  windowDays: number,
  isEvent: boolean,
): Promise<{ row: MatchRow; linked: boolean } | null> {
  const [byRef] = await db.query<MatchRow>(
    `select m.* from match m join match_source_ref r on r.match_id = m.id
     where r.source = $1 and r.external_id = $2`,
    [source, externalId],
  );
  if (byRef) return { row: byRef, linked: true };
  if (homeId == null || (awayId == null && !isEvent)) return null;
  // 이벤트는 시각이 있어야 같은 세션을 가릴 수 있다
  if (isEvent && !startAt) return null;

  // 다른 소스로 이미 저장된 같은 대진: 같은 대회·홈·원정이고 이 소스와는 아직 연결되지 않은 경기 중 시각이 가장 가까운 것
  const [byTeams] = await db.query<MatchRow>(
    `select m.* from match m
     where m.competition_id = $1 and m.home_team_id = $2 and m.away_team_id is not distinct from $3
       and not exists (select 1 from match_source_ref r where r.match_id = m.id and r.source = $4)
       and ($5::timestamptz is null or m.start_at is null
            or abs(extract(epoch from (m.start_at - $5::timestamptz))) < $6::float8 * 86400)
     order by case when $5::timestamptz is null or m.start_at is null then 0
                   else abs(extract(epoch from (m.start_at - $5::timestamptz))) end
     limit 1`,
    [competitionId, homeId, awayId, source, startAt, windowDays],
  );
  return byTeams ? { row: byTeams, linked: false } : null;
}
