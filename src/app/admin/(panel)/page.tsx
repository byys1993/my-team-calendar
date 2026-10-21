import Link from "next/link";
import { getDb } from "@/lib/db";
import { adminOverview, toKst } from "@/lib/manual/admin";
import { SOURCE_LABEL } from "@/lib/sources";

const when = (d: Date | null) => {
  if (!d) return "—";
  const k = toKst(d);
  return `${k.date} ${k.time}`;
};

export default async function AdminHome() {
  const { competitions, failures, reviewCount } = await adminOverview(getDb());
  return (
    <>
      <h1>현황</h1>
      <p className="muted">시각은 모두 한국 시간입니다.</p>
      {reviewCount > 0 && (
        <p className="notice-box">
          한국어 이름이 필요한 팀이 {reviewCount}개 있습니다. <Link href="/admin/teams">팀 이름 고치기</Link>
        </p>
      )}
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
                  {c.feed === "manual" ? <Link href={`/admin/matches?league=${c.slug}`}>{c.name_ko}</Link> : c.name_ko}
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
