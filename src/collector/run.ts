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
  unmapped?: string[];
  errors: string[];
}

// 지금 할 수집: 전체 수집이 12시간 지났으면 full,
// 경기 당일(±18시간 안에 경기)이나 포스트시즌이면 매시간 recent, 그 외에는 null
export async function dueMode(db: Db, c: CompetitionRow, now = new Date()): Promise<SyncMode | null> {
  const [st] = await db.query<{ last_attempt_at: Date | null; last_full_at: Date | null }>(
    "select last_attempt_at, last_full_at from competition_status where competition_id = $1",
    [c.id],
  );
  const since = (d: Date | null | undefined) => (d ? (now.getTime() - d.getTime()) / 60_000 : Infinity);
  if (since(st?.last_full_at) >= NORMAL_INTERVAL_MIN) return "full";
  const [{ hot }] = await db.query<{ hot: boolean }>(
    `select exists (select 1 from match where competition_id = $1
       and start_at between $2::timestamptz - interval '6 hours' and $2::timestamptz + interval '18 hours') as hot`,
    [c.id, now.toISOString()],
  );
  if ((c.postseason || hot) && since(st?.last_attempt_at) >= HOT_INTERVAL_MIN) return "recent";
  return null;
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
      // 시즌 전체가 0건이면 응답 이상이다 (최근 며칠은 0건일 수 있음)
      if (mode === "full" && matches.length === 0) throw new Error("경기 0건 (응답 이상으로 간주)");
      const r = await db.tx((t) => upsertMatches(t, c.id, ref.source, matches, { autoCreateTeams: !isFallback }));
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
  const comps = await db.query<CompetitionRow>(
    "select id, slug, postseason from competition where feed = 'auto' order by id",
  );
  const results: SyncOutcome[] = [];
  for (const c of comps) {
    if (opts.only?.length && !opts.only.includes(c.slug)) continue;
    const mode = opts.force ? "full" : await dueMode(db, c);
    if (!mode) {
      log(`${c.slug}: 건너뜀 (아직 갱신 주기가 아님)`);
      continue;
    }
    const r = await syncCompetition(db, c, adapters, mode);
    results.push(r);
    const label = `${c.slug} [${mode === "full" ? "전체" : "최근"}]`;
    if (r.ok) {
      log(`${label}: ${r.source}${r.fallback ? " (대체 소스)" : ""} 신규 ${r.inserted} · 갱신 ${r.updated} · 건너뜀 ${r.skipped}`);
      if (r.unmapped?.length) log(`  매핑 안 된 팀: ${r.unmapped.join(", ")}`);
    } else {
      log(`${label}: 모든 소스 실패`);
    }
    for (const e of r.errors) log(`  실패 — ${e}`);
  }
  return results;
}
