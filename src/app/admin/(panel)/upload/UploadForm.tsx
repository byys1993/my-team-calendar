"use client";

import { useActionState } from "react";
import { uploadCsv, type UploadState } from "../../actions";

export function UploadForm() {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadCsv, {});
  return (
    <form action={action} className="admin-form">
      <label>
        CSV 파일
        <input type="file" name="file" accept=".csv,text/csv" required />
      </label>
      <div className="row">
        <button type="submit" name="mode" value="check" className="ghost" disabled={pending}>
          검사
        </button>
        <button type="submit" name="mode" value="save" className="primary" disabled={pending}>
          {pending ? "처리 중…" : "저장"}
        </button>
      </div>

      {state.errors && state.errors.length > 0 && (
        <div className="error-box" role="alert">
          <strong>오류 {state.errors.length}건 — 아무것도 저장하지 않았습니다.</strong>
          <ul>
            {state.errors.slice(0, 50).map((e, i) => (
              <li key={i}>
                {e.line > 0 && <span className="muted">{e.line}번째 줄: </span>}
                {e.message}
              </li>
            ))}
          </ul>
          {state.errors.length > 50 && <p className="muted">외 {state.errors.length - 50}건</p>}
        </div>
      )}
      {state.done && (
        <div className="ok-box" role="status">
          <strong>
            {state.done === "saved" ? "저장했습니다." : "오류가 없습니다. 저장을 눌러 반영하세요."} ({state.rows}경기)
          </strong>
          <ul>
            {state.summary?.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
