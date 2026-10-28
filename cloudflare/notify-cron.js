// Cloudflare Worker: 마이팀 캘린더의 정시 작업을 맡는다.
// GitHub Actions 예약 실행은 무료 플랜에서 수십 분~몇 시간씩 밀리거나 건너뛰는 일이 있어,
// 시각이 중요한 두 가지를 이 Worker 의 Cron Triggers(정시 실행)로 부른다.
//
//   */10 * * * *  경기 알림 메일 발송 호출 (사이트가 하루 한 통만 보내도록 막아 준다)
//   7 * * * *     GitHub Actions 일정 수집(sync-schedules) 실행 요청
//
// 비밀값 (Worker → Settings → Variables and Secrets):
//   CRON_SECRET   Vercel·GitHub 에 넣은 것과 같은 값
//   GITHUB_TOKEN  GitHub 세분화 토큰 (저장소 my-team-calendar, 권한 Actions: Read and write)
// 설정 절차: docs/DEPLOY.md 8번
const SITE = "https://www.my-team-calendar.com/api/cron/notify";
const WORKFLOW = "https://api.github.com/repos/byys1993/my-team-calendar/actions/workflows/sync.yml/dispatches";

async function notify(env) {
  const res = await fetch(SITE, { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } });
  console.log("notify", res.status, await res.text());
  if (!res.ok) throw new Error(`알림 발송 호출 실패: ${res.status}`);
}

async function sync(env) {
  if (!env.GITHUB_TOKEN) return console.log("sync 건너뜀: GITHUB_TOKEN 없음");
  const res = await fetch(WORKFLOW, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "my-team-calendar-cron",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  // 성공하면 204 (내용 없음)
  console.log("sync", res.status, res.status === 204 ? "" : await res.text());
  if (res.status !== 204) throw new Error(`수집 실행 요청 실패: ${res.status}`);
}

export default {
  async scheduled(event, env) {
    // 트리거 문자열은 대시보드 표기와 다를 수 있어 예약 시각의 '분'으로 고른다 (10분마다 실행은 7분에 오지 않는다)
    const minute = new Date(event.scheduledTime).getUTCMinutes();
    console.log("cron", JSON.stringify(event.cron), "minute", minute);
    if (minute === 7) await sync(env);
    else await notify(env);
  },
  // 주소를 브라우저로 열었을 때 오류 대신 안내만 보여 준다
  async fetch() {
    return new Response("my-team-calendar cron worker (예약 실행 전용)", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  },
};
