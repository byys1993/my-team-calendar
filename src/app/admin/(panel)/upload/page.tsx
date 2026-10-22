import { COLUMNS } from "@/lib/manual/import";
import { UploadForm } from "./UploadForm";

export default function UploadPage() {
  return (
    <>
      <h1>CSV 올리기</h1>
      <p>
        시즌 전체 일정을 한 번에 올립니다. 같은 <code>game_key</code> 로 다시 올리면 새 경기를 만들지 않고 그 경기를
        고칩니다. 파일에 없는 기존 경기는 그대로 둡니다. 지금은 KBO·KBL 모두 공식 홈페이지에서 자동 수집하므로, 자동 수집이
        실패하는 대회를 시드에서 수동 입력(feed: manual)으로 바꿨을 때만 씁니다.
      </p>
      <ul className="muted">
        <li>
          예시 파일: <a href="/samples/kbl_sample.csv">kbl_sample.csv</a> (엑셀로 열어 고친 뒤 CSV 로 저장)
        </li>
        <li>열: {COLUMNS.join(", ")}</li>
        <li>시각은 한국 시간. 시간을 비우면 &lsquo;시간 미정&rsquo;. 상태: 확정·미정·진출시·추첨대기·연기·취소</li>
        <li>먼저 &lsquo;검사&rsquo;로 오류를 확인하고, 오류가 없으면 &lsquo;저장&rsquo;하세요. 오류가 하나라도 있으면 아무것도 저장하지 않습니다.</li>
      </ul>
      <UploadForm />
    </>
  );
}
