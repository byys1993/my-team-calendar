"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";

const ID_KEY = "mtc.vid.v1";
const BEAT_MS = 60_000;

interface Stats {
  online: number;
  today: number;
  total: number;
}

// 이 브라우저의 무작위 익명 ID (방문자 수 세기에만 쓴다)
function visitorId(): string {
  try {
    const saved = localStorage.getItem(ID_KEY);
    if (saved) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(ID_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

// 헤더의 '접속 중 · 오늘 · 전체' 방문자 수. 화면이 보이는 동안 1분마다 신호를 보내며 숫자를 갱신한다.
export function VisitorStats() {
  const { m, intl } = useI18n();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const id = visitorId();
    let stopped = false;
    const beat = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/visit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (res.ok && !stopped) setStats(await res.json());
      } catch {
        // 숫자는 다음 신호 때 다시 받는다
      }
    };
    void beat();
    const timer = setInterval(beat, BEAT_MS);
    const onVisible = () => document.visibilityState === "visible" && void beat();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!stats) return null;
  const n = new Intl.NumberFormat(intl);
  return (
    <p className="visitor-stats" aria-label={m.stats.label}>
      <span className="live-dot" aria-hidden="true" />
      {m.stats.online} <b>{n.format(stats.online)}</b>
      <span className="sep">·</span>
      {m.stats.today} <b>{n.format(stats.today)}</b>
      <span className="sep">·</span>
      {m.stats.total} <b>{n.format(stats.total)}</b>
    </p>
  );
}
