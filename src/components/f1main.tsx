"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";

// F1 '주요 세션만': 켜면 연습 주행·스프린트 예선을 빼고 결승·예선·스프린트만 화면·구독 주소(f1=main)에 넣는다.
// 이 브라우저에 저장하고, 로그인하면 알림 메일에도 쓰도록 계정에 맞춘다 (CalendarApp).

const STORAGE_KEY = "mtc.f1main.v1";

export function useF1MainOnly() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      setOn(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // 저장소를 못 쓰면 모든 세션
    }
  }, []);
  const set = useCallback((v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      // 무시
    }
  }, []);
  return { on, set };
}

export function F1MainToggle({ on, onChange }: { on: boolean; onChange(v: boolean): void }) {
  const { m } = useI18n();
  return (
    <button
      type="button"
      className={`ghost spoiler-btn${on ? " on" : ""}`}
      aria-pressed={on}
      title={m.app.f1MainHint}
      onClick={() => onChange(!on)}
    >
      🏁 {m.app.f1Main}
    </button>
  );
}
