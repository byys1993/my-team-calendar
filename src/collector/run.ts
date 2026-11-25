import type { Db } from "@/lib/db";
import type { SourceAdapter } from "./types";
import { upsertMatches } from "./upsert";

export const HOT_INTERVAL_MIN = 55; // 경기 당일·포스트시즌: 매시간
export const NORMAL_INTERVAL_MIN = 11 * 60 + 30; // 평상시: 하루 2회

// full = 시즌 전체, recent = 최근 며칠 (경기 당일 매시간 갱신용, 요청 수 절약)
export type SyncMode = "full" | "recent";

export interface CompetitionRow {
  id: number;
  slug: string;
  postseason: boolean;
  type?: string;
}

export interface SyncOutcome {
  slug: string;
  mode: SyncMode;
  ok: boolean;
  source?: string;
  fallback?: boolean;
  inserted?: number;
  updated?: number;
  skipped?: number;
  removed?: number;
  unmapped?: string[];
  errors: string[];
}

// 지금 할 수집: 전체 수집이 12시간 지났으면 full,
// 경기 당일(±18시간 안에 경기)이나 포스트시즌이면 매시간 recent, 그 외에는 null
interface DueRow extends CompetitionRow {
  last_attempt_at: Date | null;
  last_full_at: Date | null;
  hot: boolean;
}

// 대회마다 따로 묻지 않고 한 번에 읽는다. Actions 서버(미국)에서 서울 DB 까지 왕복이 길어
// 대회 30여 개를 하나씩 물으면 그것만으로 15초가 걸리고, Actions 는 1분 단위로 올려 계산한다.
async function loadDueRows(db: Db, now: Date, id?: number): Promise<DueRow[]> {
  return db.query<DueRow>(
    `select c.id, c.slug, c.postseason, c.type, st.last_attempt_at, st.last_full_at,
       exists (select 1 from match m where m.competition_id = c.id
         and m.start_at between $1::timestamptz - interval '6 hours' and $1::timestamptz + interval '18 hours') as hot
     from competition c left join competition_status st on st.competition_id = c.id
     where ${id === undefined ? "c.feed = 'auto'" : "c.id = $2"}
     order by c.id`,
    id === undefined ? [now.toISOString()] : [now.toISOString(), id],
  );
}

function pickMode(r: Pick<DueRow, "postseason" | "last_attempt_at" | "last_full_at" | "hot">, now: Date): SyncMode | null {
  const since = (d: Date | null | undefined) => (d ? (now.getTime() - new Date(d).getTime()) / 60_000 : Infinity);
  if (since(r.last_full_at) >= NORMAL_INTERVAL_MIN) return "full";
  if ((r.postseason || r.hot) && since(r.last_attempt_at) >= HOT_INTERVAL_MIN) return "recent";
  return null;
}

export async function dueMode(db: Db, c: CompetitionRow, now = new Date()): Promise<SyncMode | null> {
  const [r] = await loadDueRows(db, now, c.id);
  return pickMode({ last_attempt_at: r?.last_attempt_at ?? null, last_full_at: r?.last_full_at ?? null, hot: r?.hot ?? false, postseason: c.postseason }, now);
}

// 우선순위대로 소스를 시도하고, 실패하면 다음 소스로 넘어간다. 시도마다 sync_run에 기록한다.
export async function syncCompetition(
  db: Db,
  c: CompetitionRow,
  adapters: Record<string, SourceAdapter>,
  mode: SyncMode = "full",
): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { slug: c.slug, mode, ok: false, errors: [] };
  const refs = await db.query<{ source: string; external_id: string; priority: number }>(
    "select source, external_id, priority from competition_source_ref where competition_id = $1 order by priority",
    [c.id],
  );
  await db.query(
    `insert into competition_status (competition_id, last_attempt_at) values ($1, now())
     on conflict (competition_id) do update set last_attempt_at = now()`,
    [c.id],
  );

  for (const [i, ref] of refs.entries()) {
    const isFallback = i > 0;
    const [{ id: runId }] = await db.query<{ id: string }>(
      "insert into sync_run (competition_id, source, is_fallback) values ($1, $2, $3) returning id",
      [c.id, ref.source, isFallback],
    );
    try {
      const adapter = adapters[ref.source];
      if (!adapter) throw new Error(`등록되지 않은 소스: ${ref.source}`);
      const matches =
        mode === "recent" && adapter.fetchRecent
          ? await adapter.fetchRecent(ref.external_id)
          : await adapter.fetchMatches(ref.external_id);
      // 리그 시즌 전체가 0건이면 응답 이상이다.
      // 최근 며칠, 그리고 우리 팀이 아직 합류하지 않은(추첨 전) 컵대회는 0건일 수 있다.
      if (mode === "full" && c.type !== "cup" && matches.length === 0) {
        throw new Error("경기 0건 (응답 이상으로 간주)");
      }
      const r = await db.tx((t) =>
        upsertMatches(t, c.id, ref.source, matches, {
          autoCreateTeams: !isFallback,
          coverage: matches.coverage,
          datedIds: adapter.datedIds,
        }),
      );
      await db.query(
        `update sync_run set finished_at = now(), ok = true, fetched = $2, inserted = $3, updated = $4, skipped = $5,
           error = $6 where id = $1`,
        [runId, matches.length, r.inserted, r.updated, r.skipped,
          r.unmapped.length ? `매핑 안 된 팀: ${r.unmapped.join(", ")}` : null],
      );
      await db.query(
        `update competition_status set last_success_at = now(), last_source = $2,
           last_full_at = case when $3 then now() else last_full_at end
         where competition_id = $1`,
        [c.id, ref.source, mode === "full"],
      );
      return { ...outcome, ok: true, source: ref.source, fallback: isFallback, ...r };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outcome.errors.push(`${ref.source}: ${msg}`);
      await db.query("update sync_run set finished_at = now(), ok = false, error = $2 where id = $1", [runId, msg]);
    }
  }
  return outcome;
}

export async function syncAll(
  db: Db,
  adapters: Record<string, SourceAdapter>,
  opts: { force?: boolean; only?: string[]; log?: (msg: string) => void } = {},
): Promise<SyncOutcome[]> {
  const log = opts.log ?? (() => {});
  const now = new Date();
  const comps = await loadDueRows(db, now);
  const results: SyncOutcome[] = [];
  for (const c of comps) {
    if (opts.only?.length && !opts.only.includes(c.slug)) continue;
    const mode = opts.force ? "full" : pickMode(c, now);
    if (!mode) {
      log(`${c.slug}: 건너뜀 (아직 갱신 주기가 아님)`);
      continue;
    }
    const r = await syncCompetition(db, c, adapters, mode);
    results.push(r);
    const label = `${c.slug} [${mode === "full" ? "전체" : "최근"}]`;
    if (r.ok) {
      log(`${label}: ${r.source}${r.fallback ? " (대체 소스)" : ""} 신규 ${r.inserted} · 갱신 ${r.updated} · 건너뜀 ${r.skipped}${r.removed ? ` · 옛 일정 삭제 ${r.removed}` : ""}`);
      if (r.unmapped?.length) log(`  매핑 안 된 팀: ${r.unmapped.join(", ")}`);
    } else {
      log(`${label}: 모든 소스 실패`);
    }
    for (const e of r.errors) log(`  실패 — ${e}`);
  }
  return results;
}
