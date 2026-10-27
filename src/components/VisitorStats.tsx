"use client";

import { useEffect } from "react";
import { visitorId } from "./track";

const BEAT_MS = 60_000;

// 방문자 수 세기: 화면이 보이는 동안 1분마다 신호만 보낸다.
// 숫자는 사용자가 충분히 많아질 때까지 화면에 보여 주지 않고 관리자 현황에서만 본다.
export function VisitorBeacon() {
  useEffect(() => {
    const id = visitorId();
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      }).catch(() => {});
    };
    beat();
    const timer = setInterval(beat, BEAT_MS);
    const onVisible = () => document.visibilityState === "visible" && beat();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
