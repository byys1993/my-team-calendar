"use client";

import { useActionState } from "react";
import type { AdminMatch } from "@/lib/manual/admin";
import { saveMatch } from "../../actions";
import { STATUS_LABEL_ADMIN } from "../statusLabels";

interface Props {
  league: string;
  teams: { slug: string; name_ko: string }[];
  match?: AdminMatch; // 없으면 새 경기
  defaultDate?: string;
}

export function MatchForm({ league, teams, match, defaultDate }: Props) {
  const [state, action, pending] = useActionState(saveMatch, {});
  const teamSelect = (name: "home" | "away", value: string | null | undefined) => (
    <select name={name} defaultValue={value ?? ""}>
      <option value="">(미정 — 아래 표시 문구 사용)</option>
      {teams.map((t) => (
        <option key={t.slug} value={t.slug}>
          {t.name_ko}
        </option>
      ))}
    </select>
  );
  return (
    <form action={action} className="admin-form">
      <input type="hidden" name="id" value={match?.id ?? ""} />
      <input type="hidden" name="league" value={league} />
      <label>
        경기 키 {match && <span className="muted">(바꿀 수 없음)</span>}
        <input
          name="game_key"
          defaultValue={match?.gameKey ?? ""}
          readOnly={!!match}
          required
          placeholder="예: 2027-KS1-SAMSUNG"
          pattern="[\w가-힣\-]+"
        />
      </label>
      <div className="grid2">
        <label>
          날짜 (한국 시간)
          <input type="date" name="date" defaultValue={match?.date ?? defaultDate} required />
        </label>
        <label>
          시간 (비우면 시간 미정)
          <input type="time" name="time" defaultValue={match?.time ?? ""} />
        </label>
      </div>
      <div className="grid2">
        <label>
          홈
          {teamSelect("home", match?.home)}
        </label>
        <label>
          원정
          {teamSelect("away", match?.away)}
        </label>
        <label>
          홈 미정 표시
          <input name="home_placeholder" defaultValue={match?.homePlaceholder ?? ""} placeholder="예: 정규시즌 1위" />
        </label>
        <label>
          원정 미정 표시
          <input name="away_placeholder" defaultValue={match?.awayPlaceholder ?? ""} placeholder="예: 플레이오프 승자" />
        </label>
      </div>
      <div className="grid2">
        <label>
          상태
          <select name="status" defaultValue={match?.status ?? "scheduled"}>
            {Object.entries(STATUS_LABEL_ADMIN).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          라운드
          <input name="round" defaultValue={match?.round ?? ""} placeholder="예: 정규시즌, 한국시리즈 1차전" />
        </label>
      </div>
      <label>
        구장
        <input name="venue" defaultValue={match?.venue ?? ""} />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <div className="row">
        <button type="submit" className="primary" disabled={pending}>
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}
