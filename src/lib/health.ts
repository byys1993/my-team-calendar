import type { Db } from "@/lib/db";

// 데이터 이상 감지: 사용자가 틀린·오래된 정보를 보기 전에 운영자가 먼저 알도록 한다.
// 알림 메일 호출(10분마다) 때 함께 점검하고, 같은 문제는 12시간에 한 번만 메일로 알린다.

export interface HealthIssue {
  key: string; // 같은 문제를 묶는 키 (재발송 간격 계산용)
  message: string;
}

const HOUR = 3600_000;
export const STALE_ALL_H = 3; // 어떤 대회도 이만큼 갱신되지 않으면 수집 전체가 멈춘 것
export const STALE_ONE_H = 30; // 대회마다 12시간마다 전체 수집 → 이만큼 넘으면 그 대회만 막힌 것
export const FAIL_STREAK = 3; // 연속 실패 횟수
export const ALERT_EVERY_H = 12;

export async function checkHealth(db: Db, now = new Date()): Promise<HealthIssue[]> {
  const issues: HealthIssue[] = [];
  const comps = await db.query<{ slug: string; name_ko: string; last_success_at: Date | null; recent: { ok: boolean; error: string | null }[] | null }>(
    `select c.slug, c.name_ko, st.last_success_at,
       (select json_agg(json_build_object('ok', r.ok, 'error', r.error) order by r.started_at desc)
          from (select ok, error, started_at from sync_run where competition_id = c.id order by started_at desc limit ${FAIL_STREAK}) r) as recent
     from competition c left join competition_status st on st.competition_id = c.id
     where c.feed = 'auto' order by c.display_order, c.id`,
  );
  const t = now.getTime();
  // 수집 실행 시각(갱신할 대회가 없어도 남음)과 마지막 성공 중 늦은 쪽
  const [beat] = await db.query<{ ran_at: Date }>("select ran_at from sync_heartbeat where id = 1");
  const latest = Math.max(beat?.ran_at.getTime() ?? 0, ...comps.map((c) => c.last_success_at?.getTime() ?? 0));
  if (latest && t - latest > STALE_ALL_H * HOUR) {
    issues.push({
      key: "stale-all",
      message: `일정 수집이 ${Math.floor((t - latest) / HOUR)}시간째 멈춰 있습니다. GitHub Actions(sync-schedules)와 Cloudflare Worker 의 매시간 실행 요청을 확인해 주세요.`,
    });
  } else {
    for (const c of comps) {
      if (c.last_success_at && t - c.last_success_at.getTime() > STALE_ONE_H * HOUR) {
        issues.push({
          key: `stale:${c.slug}`,
          message: `${c.name_ko}: ${Math.floor((t - c.last_success_at.getTime()) / HOUR)}시간째 일정이 갱신되지 않았습니다.`,
        });
      }
    }
  }
  for (const c of comps) {
    const r = c.recent ?? [];
    if (r.length >= FAIL_STREAK && r.every((x) => !x.ok)) {
      issues.push({
        key: `fail:${c.slug}`,
        message: `${c.name_ko}: 최근 ${FAIL_STREAK}번 연속 수집 실패 — ${(r[0].error ?? "원인 미상").slice(0, 200)}`,
      });
    }
  }
  // 리그(컵대회·국제대회 제외)에서 앞으로 30일 안에 경기가 있는데 한국어 이름이 없는 팀 = 새로 승격한 팀 등.
  // 컵대회의 하부리그 상대팀은 늘 있으므로 알리지 않는다 (관리자 → 팀 이름에서 볼 수 있다).
  const [review] = await db.query<{ n: number; names: string | null }>(
    `select count(distinct t.id)::int as n, string_agg(distinct t.name_en, ', ') as names
     from match m join competition c on c.id = m.competition_id
     join team t on t.id in (m.home_team_id, m.away_team_id)
     where c.type = 'league' and t.needs_review and m.start_at between $1 and $2`,
    [now.toISOString(), new Date(t + 30 * 24 * HOUR).toISOString()],
  );
  if (review.n > 0) {
    issues.push({
      key: "needs-review",
      message: `한국어 이름이 필요한 팀 ${review.n}개 (${(review.names ?? "").slice(0, 300)}). 관리자 → 팀 이름에서 고쳐 주세요.`,
    });
  }
  // 순위표가 하루 넘게 갱신되지 않음
  const stale = await db.query<{ name_ko: string }>(
    `select distinct c.name_ko from standing st join competition c on c.id = st.competition_id
     where st.kind = 'teams' and st.updated_at < $1`,
    [new Date(t - 24 * HOUR).toISOString()],
  );
  if (stale.length) {
    issues.push({ key: "standings-stale", message: `순위표가 하루 넘게 갱신되지 않은 대회: ${stale.map((s) => s.name_ko).join(", ")}` });
  }
  return issues;
}

// 수집 스크립트가 돌 때마다 호출한다
export async function recordSyncHeartbeat(db: Db, now = new Date()): Promise<void> {
  await db.query(
    "insert into sync_heartbeat (id, ran_at) values (1, $1) on conflict (id) do update set ran_at = excluded.ran_at",
    [now.toISOString()],
  );
}

// 새로 생겼거나 12시간 넘게 알리지 않은 문제만 골라 '보냄'으로 표시한다
export async function pickAlerts(db: Db, issues: HealthIssue[], now = new Date()): Promise<HealthIssue[]> {
  if (!issues.length) return [];
  const rows = await db.query<{ key: string; last_sent: Date }>("select key, last_sent from alert_state where key = any(string_to_array($1, '|'))", [
    issues.map((i) => i.key).join("|"),
  ]);
  const last = new Map(rows.map((r) => [r.key, r.last_sent.getTime()]));
  const due = issues.filter((i) => !last.has(i.key) || now.getTime() - last.get(i.key)! > ALERT_EVERY_H * HOUR);
  for (const i of due) {
    await db.query(
      "insert into alert_state (key, last_sent) values ($1, $2) on conflict (key) do update set last_sent = excluded.last_sent",
      [i.key, now.toISOString()],
    );
  }
  return due;
}

// 운영자(문의 받는 주소)에게 보내는 메일 (이상 알림·주간 리포트)
export async function sendAdminMail(subject: string, text: string): Promise<void> {
  const to = process.env.CONTACT_EMAIL?.trim();
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM?.replace(/\blogin@/, "alert@");
  if (!to || !key || !from) {
    console.log(`[admin mail] ${subject}\n${text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`운영자 메일 실패: ${res.status} ${await res.text()}`);
}

export async function sendAlertMail(issues: HealthIssue[], siteUrl: string): Promise<void> {
  const text = [...issues.map((i) => `• ${i.message}`), "", `관리자 현황: ${siteUrl}/admin`].join("\n");
  await sendAdminMail(`[마이팀 캘린더] 확인이 필요한 문제 ${issues.length}건`, text);
}
