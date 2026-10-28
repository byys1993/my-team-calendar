"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/client";
import type { ScheduleMatch } from "@/lib/schedule";
import { f1Driver } from "@/lib/f1names";
import { extraLabel, resultFor } from "./result";
import { BoxScoreButton } from "./BoxScore";

// 스포일러 방지: 켜면 끝난 경기의 점수·승패를 가리고, 경기마다 '결과 보기'를 눌러야 보인다.
// 다시보기로 볼 사람을 위한 기능이라 이 브라우저에만 저장한다.

const STORAGE_KEY = "mtc.spoiler.v1";

const Ctx = createContext<{ hide: boolean; setHide(v: boolean): void }>({
  hide: false,
  setHide: () => {},
});

export function SpoilerProvider({ children }: { children: ReactNode }) {
  const [hide, setHideState] = useState(false);
  useEffect(() => {
    try {
      setHideState(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // 저장소를 못 쓰면 끈 상태로
    }
  }, []);
  const setHide = useCallback((v: boolean) => {
    setHideState(v);
    try {
      localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      // 무시
    }
  }, []);
  return <Ctx.Provider value={{ hide, setHide }}>{children}</Ctx.Provider>;
}

export const useSpoiler = () => useContext(Ctx);

export function SpoilerToggle() {
  const { m } = useI18n();
  const { hide, setHide } = useSpoiler();
  return (
    <button
      type="button"
      className={`ghost spoiler-btn${hide ? " on" : ""}`}
      aria-pressed={hide}
      title={m.results.spoilerHint}
      onClick={() => setHide(!hide)}
    >
      {hide ? "🙈" : "👁"} {m.results.spoiler}
    </button>
  );
}

// F1 결과: 결승·스프린트는 '🥇 베르스타펜 🥈 노리스 🥉 르클레르', 예선은 '폴 포지션 베르스타펜'
const MEDAL = ["🥇", "🥈", "🥉"];
export function PodiumResult({ match }: { match: ScheduleMatch }) {
  const { m, locale } = useI18n();
  const { hide } = useSpoiler();
  const [revealed, setRevealed] = useState(false);
  const podium = match.podium;
  if (!podium?.length) return null;
  if (hide && !revealed) {
    return (
      <button type="button" className="reveal-btn" onClick={() => setRevealed(true)}>
        {m.results.reveal}
      </button>
    );
  }
  const name = (p: (typeof podium)[number]) => f1Driver(p.driverId, p.name, locale);
  const isQuali = match.title?.endsWith(":qualifying");
  return (
    <span className="podium">
      {isQuali ? `${m.results.pole} ${name(podium[0])}` : podium.map((p) => `${MEDAL[p.pos - 1] ?? `${p.pos}.`} ${name(p)}`).join("  ")}
    </span>
  );
}

// 목록의 결과 표시: '승 3:1' (+ 미국 4대 리그는 '기록' 버튼). 스포일러 방지 중이면 '결과 보기' 버튼을 눌러야 보인다.
export function MatchResult({ match, team }: { match: ScheduleMatch; team: string }) {
  const { m, t: fmt } = useI18n();
  const { hide } = useSpoiler();
  const [revealed, setRevealed] = useState(false);
  const r = resultFor(match, team);
  if (!r) return null;
  const extra = extraLabel(match.extra, m.results);
  if (hide && !revealed) {
    return (
      <button type="button" className="reveal-btn" onClick={() => setRevealed(true)}>
        {m.results.reveal}
      </button>
    );
  }
  return (
    <>
      <span className={`result result-${r.outcome}`}>
        {m.results[r.outcome]} {r.mine}:{r.theirs}
        {r.pen && <small className="result-pen">{fmt(m.results.pens, { a: r.pen.mine, b: r.pen.theirs })}</small>}
        {!r.pen && extra && <small className="result-pen">{extra}</small>}
      </span>
      <BoxScoreButton match={match} team={team} />
    </>
  );
}
