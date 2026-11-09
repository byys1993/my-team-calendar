import type { Db } from "@/lib/db";
import { funnel, type FunnelRow } from "@/lib/events";
import { checkHealth } from "@/lib/health";
import { getIcsStats } from "@/lib/icsStats";
import { seoulDay } from "@/lib/visitors";

// 매주 월요일 아침 운영자에게 보내는 '운영 리포트'. 따로 기억하지 않아도 이용 흐름·규모·문제를 받아 볼 수 있게 한다.

const DAY = 86_400_000;
export const REPORT_HOUR_KST = 9;

const steps: [string, (f: FunnelRow) => number][] = [
  ["방문", (f) => f.visitors],
  ["팀 고르지 않고 선택 창 닫음", (f) => f.events.picker_skip],
  ["팀 고름", (f) => f.events.team_pick],
  ["내 팀 공유", (f) => f.events.share],
  ["캘린더 구독 창 열기", (f) => f.events.sub_open],
  ["  └ 일정 위 안내 칸에서", (f) => f.events.sub_notice],
  ["캘린더 구독 버튼", (f) => subscribed(f)],
  ["로그인", (f) => f.events.login],
  ["알림 메일 켬", (f) => f.events.notify_on],
  ["문의 보냄", (f) => f.events.contact_sent],
];

// 운영자가 해당 기간의 리포트에서 안내받을 확인 거리 (날짜는 한국 시간, from·to 포함). 지난 항목은 지워도 된다
export const REPORT_TASKS: { from: string; to: string; text: string }[] = [
  {
    from: "2026-11-09",
    to: "2026-11-16",
    text: "네이버 서치어드바이저: 리포트 → 수집 현황, 콘텐츠 노출/클릭의 '검색 웹문서'를 캡처해 Claude 에게 보여 주세요 (팀·리그 페이지가 잡혔는지, 주말 경기 날 노출이 되풀이되는지)",
  },
  {
    from: "2026-11-16",
    to: "2026-11-30",
    text: "Search Console: 실적(지난 28일) 화면을 캡처해 Claude 에게 보여 주세요 (11/4 설명 변경 전: 노출 1,610 · 클릭 1 · 클릭률 0.1% · 평균 8.6위). 제목에 '캘린더 구독'을 넣을지도 같이 정해요",
  },
  {
    from: "2026-11-23",
    to: "2026-11-30",
    text: "첫 화면 안내 효과: 이 메일을 Claude 에게 보여 주세요. 11/9 팀 선택 창에 사이트 설명을 넣었어요 (넣기 전 팀 고름 6% 안팎). '팀 고르지 않고 선택 창 닫음'과 '안내 칸에서 구독 창 엶'이 어떻게 나오는지 봐요",
  },
];

const subscribed = (f: FunnelRow) => Math.max(f.events.sub_apple, f.events.sub_google, f.events.sub_copy);
const pct = (n: number, base: number) => (base ? `${Math.round((n / base) * 100)}%` : "-");
const delta = (now: number, before: number) => (now === before ? "±0" : now > before ? `+${now - before}` : `${now - before}`);

export interface WeeklyReport {
  subject: string;
  text: string;
}

export async function buildWeeklyReport(db: Db, siteUrl: string, now = new Date()): Promise<WeeklyReport> {
  // 조회는 하나씩 차례로 (한 연결에 동시에 보내면 Supabase 풀러에서 멈춘다)
  // 다 끝난 지난주(월~일)와 그 전 주, 최근 30일 — 모두 어제까지
  const week = await funnel(db, 7, new Date(now.getTime() - DAY));
  const prev = await funnel(db, 7, new Date(now.getTime() - 8 * DAY));
  const month = await funnel(db, 30, new Date(now.getTime() - DAY));
  const ics = await getIcsStats(db, now);
  const users = await db.query<{
    users: number;
    notify: number;
    joined: number;
  }>(
    `select count(*)::int as users, count(*) filter (where notify_mode <> 'off')::int as notify,
         count(*) filter (where created_at > $1)::int as joined from app_user`,
    [new Date(now.getTime() - 7 * DAY).toISOString()],
  );
  const issues = await checkHealth(db, now);
  // 많이 고른 팀: 로그인 계정의 팀 + 캘린더 구독 주소의 팀 (최근 30일)
  const top = await db.query<{ name: string; n: number }>(
    `with picks as (
       select s->>'slug' as slug from app_user u, jsonb_array_elements(u.selections) s
       union all
       select unnest(string_to_array(teams, ',')) from ics_feed where last_seen > $1
     )
     select t.name_ko as name, count(*)::int as n from picks p join team t on t.slug = p.slug
     group by t.name_ko order by n desc, t.name_ko limit 5`,
    [new Date(now.getTime() - 30 * DAY).toISOString()],
  );

  const from = seoulDay(new Date(now.getTime() - 7 * DAY));
  const to = seoulDay(new Date(now.getTime() - DAY));
  const lines: string[] = [];
  lines.push(`마이팀 캘린더 주간 운영 리포트 (${from} ~ ${to})`, "");
  const today = seoulDay(now);
  const tasks = REPORT_TASKS.filter((t) => t.from <= today && today <= t.to);
  if (tasks.length) lines.push("■ 이번 주 확인할 일", ...tasks.map((t) => `  · ${t.text}`), "");
  lines.push("■ 이용 흐름 — 지난 7일 (비율은 방문자 대비, 괄호는 그 전 주와 비교)");
  for (const [name, get] of steps) {
    lines.push(`  ${name}: ${get(week)}명 · ${pct(get(week), week.visitors)} (${delta(get(week), get(prev))})`);
  }
  lines.push("", "■ 지난 30일");
  lines.push(
    `  방문 ${month.visitors}명 → 팀 고름 ${month.events.team_pick}명 → 캘린더 구독 ${subscribed(month)}명 → 알림 켬 ${month.events.notify_on}명`,
  );
  lines.push("", "■ 지금 규모");
  lines.push(`  캘린더 구독 주소: 최근 7일 ${ics.active7d}개 (전체 ${ics.total}개)`);
  lines.push(`  로그인 계정: ${users[0].users}명 (지난주 새로 ${users[0].joined}명) · 알림 메일 켬 ${users[0].notify}명`);
  lines.push("", "■ 많이 고른 팀 (계정·캘린더 구독 기준)");
  lines.push(top.length ? `  ${top.map((t, i) => `${i + 1}. ${t.name} (${t.n})`).join("  ")}` : "  아직 데이터가 없습니다.");
  lines.push("", "■ 지금 확인이 필요한 문제");
  lines.push(issues.length ? issues.map((i) => `  • ${i.message}`).join("\n") : "  없음");
  lines.push(
    "",
    "■ 더 보기",
    `  유입 경로·페이지별 방문: Vercel → my-team-calendar → Analytics`,
    `  관리자 현황: ${siteUrl}/admin`,
    "",
    "이 메일 내용을 그대로 Claude 에게 보여 주면, 숫자를 보고 다음 개선점을 같이 정할 수 있어요.",
  );
  const subject = `[마이팀 캘린더] 주간 리포트 · 방문 ${week.visitors}명 · 팀 선택 ${week.events.team_pick}명 · 구독 ${subscribed(week)}명`;
  return { subject, text: lines.join("\n") };
}

// 월요일 오전 9시(한국 시간) 이후 첫 호출에서 한 번만 보낸다 (지난 발송 후 6일이 안 지났으면 건너뜀)
export async function weeklyReportDue(db: Db, now = new Date()): Promise<boolean> {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  if (kst.getUTCDay() !== 1 || kst.getUTCHours() < REPORT_HOUR_KST) return false;
  const [row] = await db.query<{ last_sent: Date }>("select last_sent from alert_state where key = 'weekly-report'");
  return !row || now.getTime() - row.last_sent.getTime() > 6 * DAY;
}

export async function markWeeklyReportSent(db: Db, now = new Date()): Promise<void> {
  await db.query(
    `insert into alert_state (key, last_sent) values ('weekly-report', $1)
     on conflict (key) do update set last_sent = excluded.last_sent`,
    [now.toISOString()],
  );
}
