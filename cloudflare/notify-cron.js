// Cloudflare Worker: 10분마다 마이팀 캘린더의 경기 알림 메일 발송을 호출한다.
// GitHub Actions 예약 실행은 수십 분씩 밀리거나 건너뛰는 일이 있어, 정시성이 중요한 알림 발송만 이 Worker 가 맡는다.
// (같은 날 두 번 보내지 않도록 사이트가 막아 주므로 GitHub 쪽 호출과 겹쳐도 괜찮다)
//
// 설정 (docs/DEPLOY.md 8번):
//   - 비밀값 CRON_SECRET: Vercel·GitHub 에 넣은 것과 같은 값
//   - Cron Trigger: */10 * * * *
const URL = "https://www.my-team-calendar.com/api/cron/notify";

export default {
  async scheduled(_event, env) {
    const res = await fetch(URL, { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } });
    const body = await res.text();
    // Workers 로그(Observability)에 결과를 남긴다: {"checked":..,"sent":..}
    console.log(res.status, body);
    if (!res.ok) throw new Error(`알림 발송 호출 실패: ${res.status}`);
  },
};
