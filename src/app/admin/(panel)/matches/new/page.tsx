import Link from "next/link";
import { getDb } from "@/lib/db";
import { manualTeams } from "@/lib/manual/admin";
import { normalizeDate } from "@/lib/manual/import";
import { MatchForm } from "../MatchForm";

export default async function NewMatchPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string; date?: string }>;
}) {
  const sp = await searchParams;
  const league = sp.league === "kbl" ? "kbl" : "kbo";
  const date = normalizeDate(sp.date ?? "") ?? undefined;
  const teams = await manualTeams(getDb(), league);
  return (
    <>
      <p>
        <Link href={`/admin/matches?league=${league}`}>‹ 목록</Link>
      </p>
      <h1>{league.toUpperCase()} 경기 추가</h1>
      <p className="muted">
        포스트시즌 &lsquo;진출 시&rsquo; 경기는 후보 팀마다 하나씩 만들고 상태를 &lsquo;진출 시&rsquo;로 두세요. 상대가 이미 정해진
        팀(예: 정규시즌 1위)은 상대를 비우고 &lsquo;플레이오프 승자&rsquo;처럼 표시 문구를 적으면 됩니다.
      </p>
      <MatchForm league={league} teams={teams} defaultDate={date} />
    </>
  );
}
