import Link from "next/link";
import { getDb } from "@/lib/db";
import { listManualMatches, toKst } from "@/lib/manual/admin";
import { loadManualCompetitions } from "@/lib/manual/import";
import { STATUS_LABEL_ADMIN } from "../statusLabels";

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string; month?: string; saved?: string; deleted?: string }>;
}) {
  const sp = await searchParams;
  const db = getDb();
  // 수동 입력 대회만 (현재 KBL. KBO 는 공식 사이트에서 자동 수집)
  const leagues = (await loadManualCompetitions(db)).map((c) => ({ slug: c.slug, name: c.slug.toUpperCase() }));
  const league = leagues.find((l) => l.slug === sp.league)?.slug ?? leagues[0]?.slug ?? "kbl";
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : toKst(new Date()).date.slice(0, 7);
  const matches = await listManualMatches(db, league, month);
  const href = (l: string, m: string) => `/admin/matches?league=${l}&month=${m}`;

  return (
    <>
      <h1>경기 수정</h1>
      {sp.saved && <p className="ok-box">저장했습니다.</p>}
      {sp.deleted && <p className="ok-box">삭제했습니다.</p>}
      <div className="admin-toolbar">
        <div className="tabs">
          {leagues.map((l) => (
            <Link key={l.slug} href={href(l.slug, month)} className={l.slug === league ? "tab active" : "tab"}>
              {l.name}
            </Link>
          ))}
        </div>
        <div className="cal-nav">
          <Link className="icon-btn" href={href(league, shiftMonth(month, -1))} aria-label="이전 달">
            ‹
          </Link>
          <strong>{month.replace("-", "년 ")}월</strong>
          <Link className="icon-btn" href={href(league, shiftMonth(month, 1))} aria-label="다음 달">
            ›
          </Link>
        </div>
        <Link className="primary" href={`/admin/matches/new?league=${league}&date=${month}-01`}>
          경기 추가
        </Link>
      </div>
      {matches.length === 0 ? (
        <p className="muted">이 달에는 경기가 없습니다. CSV 로 올리거나 &lsquo;경기 추가&rsquo;를 누르세요.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>날짜</th>
              <th>시간</th>
              <th>홈</th>
              <th>원정</th>
              <th>상태</th>
              <th>라운드</th>
              <th>경기 키</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {matches.map((m) => (
              <tr key={m.id} className={m.status === "scheduled" ? "" : "tentative-row"}>
                <td>{m.date}</td>
                <td>{m.time ?? "미정"}</td>
                <td>{m.homeLabel}</td>
                <td>{m.awayLabel}</td>
                <td>{STATUS_LABEL_ADMIN[m.status]}</td>
                <td>{m.round}</td>
                <td className="muted">{m.gameKey}</td>
                <td>
                  <Link href={`/admin/matches/${m.id}`}>수정</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
