import { getDb } from "@/lib/db";
import { reviewTeams } from "@/lib/manual/admin";
import { saveTeam } from "../../actions";

export default async function TeamsPage() {
  const teams = await reviewTeams(getDb());
  return (
    <>
      <h1>팀 이름 고치기</h1>
      <p>
        컵대회·유럽대항전에서 처음 만난 상대팀은 수집할 때 영어 이름으로 자동 생성됩니다. 한국어 이름을 넣고 저장하면 사이트에
        바로 반영되고 이 목록에서 빠집니다.
      </p>
      {teams.length === 0 ? (
        <p className="muted">고칠 팀이 없습니다.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>원래 이름</th>
              <th>대회</th>
              <th>한국어 이름 / 줄임 이름</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.slug}>
                <td>{t.name_en}</td>
                <td className="muted">{t.competitions}</td>
                <td>
                  <form action={saveTeam} className="inline-form">
                    <input type="hidden" name="slug" value={t.slug} />
                    <input name="name_ko" defaultValue={t.name_ko === t.name_en ? "" : t.name_ko} placeholder="예: 셀틱" required />
                    <input name="short_ko" defaultValue={t.short_ko ?? ""} placeholder="줄임 (선택)" />
                    <button type="submit" className="ghost">
                      저장
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
