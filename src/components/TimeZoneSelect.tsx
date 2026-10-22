"use client";

import { useMemo } from "react";
import { useI18n } from "@/i18n/client";
import { allTimeZones, AUTO, browserTimeZone, COMMON_ZONES, utcOffset } from "./timezone";

// 헤더의 시간대 선택: 자동(브라우저) → 자주 쓰는 시간대 → 모든 시간대
export function TimeZoneSelect({ value, onChange }: { value: string; onChange(tz: string): void }) {
  const { m, t } = useI18n();
  const browser = browserTimeZone();
  const now = useMemo(() => new Date(), []);
  const label = (tz: string) => `${tz.replace(/_/g, " ")} (${utcOffset(tz, now)})`;
  const others = useMemo(() => allTimeZones().filter((z) => !COMMON_ZONES.includes(z)), []);
  return (
    <select className="tz-select" aria-label={m.app.tzLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value={AUTO}>{t(m.app.tzAuto, { tz: label(browser) })}</option>
      <optgroup label={m.app.tzCommon}>
        {COMMON_ZONES.map((z) => (
          <option key={z} value={z}>
            {label(z)}
          </option>
        ))}
      </optgroup>
      <optgroup label={m.app.tzAll}>
        {others.map((z) => (
          <option key={z} value={z}>
            {label(z)}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
