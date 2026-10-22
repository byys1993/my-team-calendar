"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

// 화면에 쓰는 시간대. 기본은 '자동'(브라우저 시간대)이고, 사용자가 고르면 이 브라우저(와 로그인 시 계정)에 저장한다.

export const AUTO = "auto";
const STORAGE_KEY = "mtc.tz.v1";

// 선택 메뉴 위쪽에 보여줄 자주 쓰는 시간대 (나머지는 '모든 시간대'에)
export const COMMON_ZONES = [
  "Asia/Seoul",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Bangkok",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Sydney",
  "Pacific/Auckland",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Africa/Cairo",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "America/Buenos_Aires",
  "Pacific/Honolulu",
  "UTC",
];

export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function allTimeZones(): string[] {
  const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  return fn ? fn("timeZone") : COMMON_ZONES;
}

// 'UTC+9', 'UTC-4:30' 같은 현재 시차
export function utcOffset(tz: string, at = new Date()): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  return (name ?? "GMT").replace("GMT", "UTC");
}

// 저장된 선택값('auto' 또는 시간대 이름)과 실제로 쓸 시간대
export function useTimeZonePref() {
  const [pref, setPrefState] = useState<string>(AUTO);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && (saved === AUTO || isValidTimeZone(saved))) setPrefState(saved);
    } catch {
      // 저장소를 못 쓰면 자동으로
    }
  }, []);
  const setPref = useCallback((next: string) => {
    if (next !== AUTO && !isValidTimeZone(next)) return;
    setPrefState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 무시
    }
  }, []);
  return { pref, setPref };
}

const Ctx = createContext<string>("UTC");

export function TimeZoneProvider({ tz, children }: { tz: string; children: ReactNode }) {
  return <Ctx.Provider value={tz}>{children}</Ctx.Provider>;
}

export const useTz = () => useContext(Ctx);
