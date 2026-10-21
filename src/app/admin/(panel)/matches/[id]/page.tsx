import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getManualMatch, manualTeams } from "@/lib/manual/admin";
import { removeMatch } from "../../../actions";
import { MatchForm } from "../MatchForm";
import { DeleteButton } from "./DeleteButton";

export default async function EditMatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const match = await getManualMatch(db, id);
  if (!match) notFound();
  const teams = await manualTeams(db, match.league);
  return (
    <>
      <p>
        <Link href={`/admin/matches?league=${match.league}&month=${match.date.slice(0, 7)}`}>‹ 목록</Link>
      </p>
      <h1>
        경기 수정 · {match.homeLabel} vs {match.awayLabel}
      </h1>
      <p className="muted">
        고유 ID {match.id} · 일정 변경 {match.sequence}회. 우천 순연은 날짜·시간을 고치거나 상태를 &lsquo;연기&rsquo;로 바꾸세요.
        경기 ID는 그대로 유지됩니다.
      </p>
      <MatchForm league={match.league} teams={teams} match={match} />
      <form action={removeMatch} className="danger-zone">
        <input type="hidden" name="id" value={match.id} />
        <input type="hidden" name="league" value={match.league} />
        <input type="hidden" name="month" value={match.date.slice(0, 7)} />
        <p className="muted">
          진출하지 못한 팀의 &lsquo;진출 시&rsquo; 경기처럼 필요 없어진 경기는 삭제할 수 있습니다. 실제로 열리지 않은 경기는
          삭제 대신 상태를 &lsquo;취소&rsquo;로 바꾸는 편이 좋습니다.
        </p>
        <DeleteButton />
      </form>
    </>
  );
}
