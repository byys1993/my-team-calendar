import Link from "next/link";
import { getDb } from "@/lib/db";
import { adminOverview, toKst } from "@/lib/manual/admin";
import { funnel, type FunnelRow } from "@/lib/events";
import { getIcsStats } from "@/lib/icsStats";
import { SOURCE_LABEL } from "@/lib/sources";
import { getStats } from "@/lib/visitors";

const when = (d: Date | null) => {
  if (!d) return "—";
  const k = toKst(d);
  return `${k.date} ${k.time}`;
};

export default async function AdminHome() {
  const db = getDb();
  // 풀러(Supabase)에 한 연결로 여러 조회를 동시에 보내면 응답이 멈추는 일이 있어 하나씩 차례로 조회한다.
  // 단계별 걸린 시간을 로그(Vercel → Logs)에 남긴다.
  const started = Date.now();
  console.log("[admin] start");
  const step = async <T,>(name: string, run: () => Promise<T>): Promise<T> => {
    const s = Date.now();
    const r = await run();
    console.log(`[admin] ${name} ${Date.now() - s}ms`);
    return r;
  };
  const { competitions, failures, reviewCount } = await step("overview", () =>
    adminOverview(db),
  );
  const visitors = await step("visitors", () => getStats(db));
  const ics = await step("ics", () => getIcsStats(db));
  const notify = await step("users", () =>
    db.query<{ users: number; on: number }>(
      `select count(*)::int as users, count(*) filter (where notify_mode <> 'off')::int as "on" from app_user`,
    ),
  );
  const week = await step("funnel7", () => funnel(db, 7));
  const month = await step("funnel30", () => funnel(db, 30));
  console.log(`[admin] total ${Date.now() - started}ms`);
  // 방문 → 팀 선택 → 구독 창 → 구독 버튼 → 로그인 → 알림 켬 (기간 안에 한 번이라도 한 사람 수)
  const subscribed = (f: FunnelRow) =>
    Math.max(f.events.sub_apple, f.events.sub_google, f.events.sub_copy);
  const steps: [string, (f: FunnelRow) => number][] = [
    ["방문", (f) => f.visitors],
    ["팀 고름", (f) => f.events.team_pick],
    ["  └ 팀 페이지에서 추가", (f) => f.events.link_add],
    ["캘린더 구독 창 열기", (f) => f.events.sub_open],
    ["캘린더 구독 버튼 누름", subscribed],
    ["로그인", (f) => f.events.login],
    ["알림 메일 켬", (f) => f.events.notify_on],
    ["문의 보냄", (f) => f.events.contact_sent],
  ];
  const pct = (n: number, f: FunnelRow) =>
    f.visitors ? ` (${Math.round((n / f.visitors) * 100)}%)` : "";
  return (
    <>
      <h1>현황</h1>
      <p className="muted">시각은 모두 한국 시간입니다.</p>
      {reviewCount > 0 && (
        <p className="notice-box">
          한국어 이름이 필요한 팀이 {reviewCount}개 있습니다.{" "}
          <Link href="/admin/teams">팀 이름 고치기</Link>
        </p>
      )}
      <section>
        <h2>이용 현황</h2>
        <p className="muted">
          사이트에는 보이지 않는 숫자입니다. 사용자가 충분히 늘면 첫 화면에 보여
          줄 수 있습니다.
        </p>
        <table className="admin-table">
          <tbody>
            <tr>
              <td>방문자 (접속 중 · 오늘 · 전체)</td>
              <td className="num">
                {visitors.online.toLocaleString()} ·{" "}
                {visitors.today.toLocaleString()} ·{" "}
                {visitors.total.toLocaleString()}
              </td>
            </tr>
            <tr>
              <td>캘린더 구독 주소 (최근 7일 · 전체)</td>
              <td className="num">
                {ics.active7d.toLocaleString()} · {ics.total.toLocaleString()}
              </td>
            </tr>
            <tr>
              <td>로그인 계정 (전체 · 알림 메일 켬)</td>
              <td className="num">
                {notify[0].users.toLocaleString()} ·{" "}
                {notify[0].on.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
      <section>
        <h2>이용 흐름</h2>
        <p className="muted">
          기간 안에 그 행동을 한 번이라도 한 사람 수 (괄호는 방문자 대비).
          어디서 많이 빠지는지 보는 용도입니다.
        </p>
        <table className="admin-table">
          <thead>
            <tr>
              <th>단계</th>
              <th>최근 7일</th>
              <th>최근 30일</th>
            </tr>
          </thead>
          <tbody>
            {steps.map(([name, get]) => (
              <tr key={name}>
                <td style={{ whiteSpace: "pre" }}>{name}</td>
                <td className="num">
                  {get(week).toLocaleString()}
                  {pct(get(week), week)}
                </td>
                <td className="num">
                  {get(month).toLocaleString()}
                  {pct(get(month), month)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2>대회별 상태</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>대회</th>
              <th>입력 방식</th>
              <th>경기 수</th>
              <th>마지막 업데이트</th>
              <th>소스</th>
            </tr>
          </thead>
          <tbody>
            {competitions.map((c) => (
              <tr key={c.slug}>
                <td>
                  {c.feed === "manual" ? (
                    <Link href={`/admin/matches?league=${c.slug}`}>
                      {c.name_ko}
                    </Link>
                  ) : (
                    c.name_ko
                  )}
                </td>
                <td>{c.feed === "manual" ? "수동" : "자동"}</td>
                <td className="num">{c.matches.toLocaleString()}</td>
                <td>{when(c.last_success_at)}</td>
                <td>{SOURCE_LABEL(c.last_source)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2>최근 수집 실패</h2>
        {failures.length === 0 ? (
          <p className="muted">없음</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>시각</th>
                <th>대회</th>
                <th>소스</th>
                <th>오류</th>
              </tr>
            </thead>
            <tbody>
              {failures.map((f, i) => (
                <tr key={i}>
                  <td>{when(f.started_at)}</td>
                  <td>{f.name_ko}</td>
                  <td>
                    {SOURCE_LABEL(f.source)}
                    {f.is_fallback && " (대체)"}
                  </td>
                  <td className="wrap">{f.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
