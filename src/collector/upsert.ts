import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/db";
import { normalizeName } from "./normalize";
import type { Coverage, SourceMatch, SourceTeam } from "./types";

// 수집 서버(GitHub Actions, 미국)와 DB(서울) 사이는 질의 한 번에 0.2초 안팎이 걸린다.
// 경기마다 질의하면 시즌 전체(수천 경기)에 수십 분이 걸리므로, 기존 데이터를 한 번에 읽고
// 신규·변경분을 묶어서(jsonb_to_recordset) 저장한다. 대회 하나에 질의 열 번 안팎이다.

export interface UpsertResult {
  inserted: number;
  updated: number;
  skipped: number;
  // 출처가 지운 옛 일정 중 지운 행 (다른 날짜로 옮겨 간 경기의 중복, 열리지 않게 된 '진출 시' 경기)
  removed: number;
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
  broadcast: string | null;
  home_score: number | null;
  away_score: number | null;
  home_pen: number | null;
  away_pen: number | null;
  extra: string | null;
  podium: unknown;
  results: unknown;
}

// 저장할 새 값 (시각은 ISO 문자열)
type NextRow = Omit<MatchRow, "id" | "start_at" | "date_only"> & { start_at: string | null; date_only: string | null };

// 대체 소스 경기와 기존 경기를 같은 경기로 볼 최대 시각 차이.
// 축구는 같은 대진이 시즌에 한 번뿐이라 연기 경기까지 넓게 보고,
// 같은 팀끼리 며칠 연속 붙는 미국 리그(시리즈)는 좁게 본다.
const CROSS_SOURCE_WINDOW_DAYS: Record<string, number> = { soccer: 120, default: 1.5 };
// 이벤트형(F1 세션)은 같은 주말의 다른 세션과 섞이지 않도록 2시간 이내만 같은 것으로 본다.
const EVENT_WINDOW_DAYS = 2 / 24;
// 한 번에 묶어 보낼 행 수
const CHUNK = 1000;

class TeamResolver {
  private known?: Map<string, number | null>;
  private byName?: Map<string, Set<number>>;

  constructor(
    private db: Db,
    private competitionId: number,
    private source: string,
    private autoCreate: boolean,
  ) {}

  async resolve(team: SourceTeam): Promise<number | null> {
    if (!this.known) {
      // 이 소스의 팀 매핑 전체를 한 번에 읽는다
      const rows = await this.db.query<{ external_id: string; team_id: number }>(
        "select external_id, team_id from team_source_ref where source = $1",
        [this.source],
      );
      this.known = new Map(rows.map((r) => [r.external_id, r.team_id]));
    }
    if (this.known.has(team.externalId)) return this.known.get(team.externalId)!;
    // 처음 보는 팀만 아래에서 개별 질의한다 (드물다)
    const teamId = (await this.autoMatch(team)) ?? (this.autoCreate ? await this.create(team) : null);
    if (teamId == null) {
      await this.db.query(
        `insert into unmapped_team (source, external_id, raw_name, competition_id) values ($1, $2, $3, $4)
         on conflict (source, external_id) do update set raw_name = excluded.raw_name, last_seen_at = now()`,
        [this.source, team.externalId, team.name, this.competitionId],
      );
    }
    this.known.set(team.externalId, teamId);
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
       values ((select sport_id from competition where id = $1), $2, coalesce($5, $3), $4, $3, $5::text is null)
       on conflict (slug) do update set name_en = excluded.name_en
       returning id`,
      [this.competitionId, slug, team.name, team.nameKo ?? team.shortName ?? null, team.nameKo ?? null],
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

// 점수는 0 이상의 정수만 받는다
const score = (v: number | null | undefined) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

// 이벤트 제목 토큰의 마지막 조각 = 세션 ('@f1:Mexico City Grand Prix:fp1' → 'fp1')
const sessionOf = (title: string) => title.slice(title.lastIndexOf(":") + 1);

const timeOf = (s: string | Date | null) => (s ? new Date(s).getTime() : null);

async function inChunks<T>(rows: T[], run: (json: string) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) await run(JSON.stringify(rows.slice(i, i + CHUNK)));
}

const MATCH_COLUMNS = `season text, round_label text, title text, home_team_id int, away_team_id int,
  home_placeholder text, away_placeholder text, start_at timestamptz, date_only date, status text, venue text,
  is_neutral boolean, broadcast text, home_score int, away_score int, home_pen int, away_pen int, extra text, podium jsonb, results jsonb`;

// 소스 경기 목록을 저장한다. 같은 경기는 기존 ID를 그대로 두고 내용만 갱신한다.
export async function upsertMatches(
  db: Db,
  competitionId: number,
  source: string,
  matches: SourceMatch[],
  opts: { autoCreateTeams?: boolean; coverage?: Coverage[]; datedIds?: boolean } = {},
): Promise<UpsertResult> {
  const result: UpsertResult = { inserted: 0, updated: 0, skipped: 0, removed: 0, unmapped: [] };
  const teams = new TeamResolver(db, competitionId, source, opts.autoCreateTeams ?? false);
  const [{ sport }] = await db.query<{ sport: string }>(
    "select s.slug as sport from competition c join sport s on s.id = c.sport_id where c.id = $1",
    [competitionId],
  );
  const windowDays = CROSS_SOURCE_WINDOW_DAYS[sport] ?? CROSS_SOURCE_WINDOW_DAYS.default;

  // 같은 소스 경기 ID가 두 번 오면 마지막 것만 쓴다
  const unique = [...new Map(matches.map((m) => [m.externalId, m])).values()];

  // 1. 팀 매핑
  const prepared: { m: SourceMatch; next: NextRow }[] = [];
  for (const m of unique) {
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
    prepared.push({
      m,
      next: {
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
        broadcast: m.broadcast ?? null,
        home_score: score(m.homeScore),
        away_score: score(m.awayScore),
        home_pen: score(m.homePen),
        away_pen: score(m.awayPen),
        extra: m.extra ?? null,
        podium: m.podium?.length ? m.podium : null,
        results: m.results?.length ? m.results : null,
      },
    });
  }

  // 2. 이 소스로 이미 저장된 경기를 한 번에 읽는다
  const linkedRows = await db.query<MatchRow & { external_id: string }>(
    `select m.*, r.external_id from match_source_ref r join match m on m.id = r.match_id
     where r.source = $1 and r.external_id in (select jsonb_array_elements_text($2::text::jsonb))`,
    [source, JSON.stringify(prepared.map((p) => p.m.externalId))],
  );
  const byExternal = new Map(linkedRows.map((r) => [r.external_id, r]));

  // 3. 다른 소스로만 저장된 같은 경기 후보 (대체 소스 전환·복귀 시). 필요할 때만 한 번 읽는다.
  let candidates: MatchRow[] | null = null;
  const claimed = new Set<string>();
  async function findCandidate(next: NextRow, isEvent: boolean): Promise<MatchRow | null> {
    if (next.home_team_id == null || (next.away_team_id == null && !isEvent)) return null;
    if (isEvent && !next.start_at) return null;
    candidates ??= await db.query<MatchRow>(
      `select m.* from match m where m.competition_id = $1
         and not exists (select 1 from match_source_ref r where r.match_id = m.id and r.source = $2)`,
      [competitionId, source],
    );
    const limit = (isEvent ? EVENT_WINDOW_DAYS : windowDays) * 86_400_000;
    const t = timeOf(next.start_at);
    let best: { row: MatchRow; diff: number } | null = null;
    for (const c of candidates) {
      if (claimed.has(c.id) || c.home_team_id !== next.home_team_id || c.away_team_id !== next.away_team_id) continue;
      // 이벤트(F1)는 같은 세션끼리만 (연습 주행과 예선이 몇 시간 차이로 붙어 있다)
      if (isEvent && c.title && next.title && sessionOf(c.title) !== sessionOf(next.title)) continue;
      const ct = timeOf(c.start_at);
      const diff = t == null || ct == null ? 0 : Math.abs(ct - t);
      if (diff >= limit) continue;
      if (!best || diff < best.diff) best = { row: c, diff };
    }
    if (best) claimed.add(best.row.id);
    return best?.row ?? null;
  }

  // 3-1. 날짜가 경기 ID에 들어가는 출처(KBO)는 순연되면 같은 경기가 새 ID로 온다. 시리즈가 통째로 하루 밀리면
  // 1차전의 새 ID가 옛 2차전의 ID가 되기도 한다. 시리즈의 N차전('@game:N')은 시즌·라운드·대진이 같으면 같은
  // 경기이므로, 이번 응답에 없는 경기와 ID가 다른 N차전에 넘어간 경기를 후보로 두고 같은 N차전에 이어 붙인다
  // (경기 ID 유지, sequence+1). 필요할 때만 한 번 읽는다.
  const isSlot = (label: string | null) => !!opts.datedIds && !!label?.includes("@game:");
  const slotKey = (r: Pick<MatchRow, "season" | "round_label" | "home_team_id" | "away_team_id">) =>
    `${r.season}|${r.round_label}|${r.home_team_id}|${r.away_team_id}`;
  type SourceRow = MatchRow & { external_id: string };
  // 이 소스의 ID가 다른 N차전을 가리키게 된 끝나지 않은 경기
  const reused = new Set<string>();
  for (const { m, next } of prepared) {
    const row = byExternal.get(m.externalId);
    if (row && row.home_score == null && isSlot(row.round_label) && isSlot(next.round_label) && slotKey(row) !== slotKey(next)) {
      reused.add(row.id);
    }
  }
  let pool: SourceRow[] | null = null;
  const loadPool = async () =>
    (pool ??= [
      // 이 소스로 저장됐지만 이번 응답에 없는 끝나지 않은 경기 (출처가 지웠거나 ID를 바꾼 경기)
      ...(await db.query<SourceRow>(
        `select m.*, r.external_id from match_source_ref r join match m on m.id = r.match_id
         where r.source = $1 and m.competition_id = $2 and m.home_score is null and m.podium is null
           and r.external_id not in (select jsonb_array_elements_text($3::text::jsonb))`,
        [source, competitionId, JSON.stringify(unique.map((m) => m.externalId))],
      )),
      ...linkedRows.filter((r) => reused.has(r.id)),
    ]);
  async function findMoved(next: NextRow, except?: string): Promise<SourceRow | null> {
    const key = slotKey(next);
    const t = timeOf(next.start_at ?? next.date_only);
    let best: { row: SourceRow; diff: number } | null = null;
    for (const c of await loadPool()) {
      if (c.id === except || claimed.has(c.id) || slotKey(c) !== key) continue;
      const ct = timeOf(c.start_at ?? c.date_only);
      const diff = t == null || ct == null ? 0 : Math.abs(ct - t);
      if (!best || diff < best.diff) best = { row: c, diff };
    }
    if (best) claimed.add(best.row.id);
    return best?.row ?? null;
  }

  // 4. 신규·연결·변경 분류
  const inserts: Record<string, unknown>[] = [];
  const links: { match_id: string; external_id: string }[] = [];
  const relinks: { match_id: string; external_id: string }[] = [];
  const updates: Record<string, unknown>[] = [];
  // 이번 응답에 있는 (연기·취소가 아닌) 시리즈 N차전
  const liveSlots = new Set<string>();
  for (const { m, next } of prepared) {
    const isEvent = next.home_team_id != null && !m.away && !!next.title;
    let row: MatchRow | null = byExternal.get(m.externalId) ?? null;
    if (row && (reused.has(row.id) || claimed.has(row.id))) {
      // 같은 N차전의 원래 행이 있으면 그 행으로, 없으면 (아무도 가져가지 않았을 때만) 이 ID의 행 그대로
      const own: MatchRow = row;
      const moved = await findMoved(next, own.id);
      if (moved) relinks.push({ match_id: moved.id, external_id: m.externalId });
      row = moved ?? (claimed.has(own.id) ? null : own);
      if (row === own) claimed.add(own.id);
      else if (!row) {
        // 이 ID의 행은 다른 N차전이 가져갔다
        const id = randomUUID();
        inserts.push({ id, ...next });
        relinks.push({ match_id: id, external_id: m.externalId });
        result.inserted++;
        continue;
      }
    } else if (row) {
      claimed.add(row.id);
    } else if (isSlot(next.round_label)) {
      row = await findMoved(next);
      if (row) relinks.push({ match_id: row.id, external_id: m.externalId });
    }
    if (!row) {
      row = await findCandidate(next, isEvent);
      if (row) links.push({ match_id: row.id, external_id: m.externalId });
    }
    const label = next.round_label ?? row?.round_label ?? null;
    if (isSlot(label) && next.status !== "postponed" && next.status !== "cancelled") {
      liveSlots.add(slotKey({ ...next, round_label: label }));
    }
    if (!row) {
      const id = randomUUID();
      inserts.push({ id, ...next });
      links.push({ match_id: id, external_id: m.externalId });
      result.inserted++;
      continue;
    }
    // 소스가 장소·라운드·제목·중계를 주지 않으면 기존 값을 지우지 않는다.
    const venue = next.venue ?? row.venue;
    const broadcast = next.broadcast ?? row.broadcast;
    // 결과는 한 번 들어오면 소스가 비워 보내도 지우지 않는다 (대체 소스가 결과를 안 주는 경우)
    const homeScore = next.home_score ?? row.home_score;
    const awayScore = next.away_score ?? row.away_score;
    const homePen = next.home_pen ?? row.home_pen;
    const awayPen = next.away_pen ?? row.away_pen;
    const extra = next.extra ?? row.extra;
    const podium = next.podium ?? row.podium;
    const results = next.results ?? row.results;
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
      row.is_neutral !== next.is_neutral ||
      row.broadcast !== broadcast ||
      row.home_score !== homeScore ||
      row.away_score !== awayScore ||
      row.home_pen !== homePen ||
      row.away_pen !== awayPen ||
      row.extra !== extra ||
      JSON.stringify(row.podium) !== JSON.stringify(podium) ||
      JSON.stringify(row.results) !== JSON.stringify(results);
    if (!scheduleChanged && !otherChanged) continue;
    updates.push({
      id: row.id,
      ...next,
      venue,
      broadcast,
      home_score: homeScore,
      away_score: awayScore,
      home_pen: homePen,
      away_pen: awayPen,
      extra,
      podium,
      results,
      round_label: roundLabel,
      title,
      bump: scheduleChanged ? 1 : 0,
    });
    result.updated++;
  }

  // 4-1. 출처가 빠짐없이 준 기간에 있던 경기가 응답에서 빠졌으면 출처가 지운 것이다 (ID가 다른 N차전에 넘어간
  // 경기는 기간과 상관없이). 다른 날짜로 옮겨 간 같은 N차전의 옛 행과 열리지 않게 된 '진출 시' 경기는 지우고,
  // 나머지는 취소로 바꾼다.
  const removes: string[] = [];
  if (opts.coverage?.length || reused.size) {
    const ranges = (opts.coverage ?? []).map((c) => [new Date(c.from).getTime(), new Date(c.to).getTime()]);
    for (const row of await loadPool()) {
      if (claimed.has(row.id) || row.status === "cancelled") continue;
      const date = row.date_only instanceof Date ? row.date_only.toISOString().slice(0, 10) : row.date_only;
      const t = row.start_at ? row.start_at.getTime() : date ? new Date(`${date}T12:00:00Z`).getTime() : null;
      const gone = reused.has(row.id) || (t != null && ranges.some(([from, to]) => t >= from && t < to));
      if (!gone) continue;
      if (row.status === "conditional" || (isSlot(row.round_label) && liveSlots.has(slotKey(row)))) {
        removes.push(row.id);
        result.removed++;
        continue;
      }
      updates.push({ ...row, start_at: row.start_at?.toISOString() ?? null, date_only: date ?? null, status: "cancelled", bump: 1 });
      result.updated++;
    }
  }

  // 5. 묶어서 저장
  if (removes.length) {
    await db.query("delete from match where id in (select jsonb_array_elements_text($1::text::jsonb)::uuid)", [
      JSON.stringify(removes),
    ]);
  }
  await inChunks(inserts, (json) =>
    db.query(
      `insert into match (id, competition_id, season, round_label, title, home_team_id, away_team_id,
         home_placeholder, away_placeholder, start_at, date_only, status, venue, is_neutral, broadcast, home_score, away_score, home_pen, away_pen, extra, podium, results)
       select x.id, $1, x.season, x.round_label, x.title, x.home_team_id, x.away_team_id, x.home_placeholder,
         x.away_placeholder, x.start_at, x.date_only, x.status, x.venue, x.is_neutral, x.broadcast, x.home_score, x.away_score, x.home_pen, x.away_pen, x.extra, x.podium, x.results
       from jsonb_to_recordset($2::text::jsonb) as x(id uuid, ${MATCH_COLUMNS})`,
      [competitionId, json],
    ),
  );
  // 이어 붙인 경기: 옛 ID 연결과 새 ID의 이전 연결을 지우고 아래에서 새로 연결한다
  await inChunks(relinks, (json) =>
    db.query(
      `delete from match_source_ref r using jsonb_to_recordset($2::text::jsonb) as x(match_id uuid, external_id text)
       where r.source = $1 and (r.match_id = x.match_id or r.external_id = x.external_id)`,
      [source, json],
    ),
  );
  links.push(...relinks);
  await inChunks(links, (json) =>
    db.query(
      `insert into match_source_ref (match_id, source, external_id)
       select x.match_id, $1, x.external_id from jsonb_to_recordset($2::text::jsonb) as x(match_id uuid, external_id text)
       on conflict do nothing`,
      [source, json],
    ),
  );
  await inChunks(updates, (json) =>
    db.query(
      `update match m set season = x.season, round_label = x.round_label, title = x.title,
         home_team_id = x.home_team_id, away_team_id = x.away_team_id, home_placeholder = x.home_placeholder,
         away_placeholder = x.away_placeholder, start_at = x.start_at, date_only = x.date_only, status = x.status,
         venue = x.venue, is_neutral = x.is_neutral, broadcast = x.broadcast, home_score = x.home_score, away_score = x.away_score, home_pen = x.home_pen, away_pen = x.away_pen, extra = x.extra, podium = x.podium, results = x.results, sequence = m.sequence + x.bump, updated_at = now()
       from jsonb_to_recordset($1::text::jsonb) as x(id uuid, bump int, ${MATCH_COLUMNS})
       where m.id = x.id`,
      [json],
    ),
  );
  return result;
}
