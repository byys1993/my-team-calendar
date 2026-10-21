import type { ScheduleMatch } from "@/lib/schedule";

// 모든 표시는 사용자 브라우저 시간대 기준 (서버 렌더링 시점에는 쓰지 않는다)

export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const dateKeyFmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
const updatedFmt = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 'YYYY-MM-DD' (브라우저 시간대)
export function toDateKey(d: Date): string {
  return dateKeyFmt.format(d);
}

export function matchDateKey(m: ScheduleMatch): string {
  return m.startAt ? toDateKey(new Date(m.startAt)) : m.dateOnly!;
}

export function hasExactTime(m: ScheduleMatch): boolean {
  return !!m.startAt && m.status !== "time_tbd";
}

export function matchTimeLabel(m: ScheduleMatch): string {
  return hasExactTime(m) ? timeFmt.format(new Date(m.startAt!)) : "시간 미정";
}

export function dateLabel(key: string): string {
  const [y, mo, d] = key.split("-").map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${mo}월 ${d}일 (${wd})`;
}

export function updatedLabel(iso: string): string {
  return updatedFmt.format(new Date(iso));
}

export function daysBetween(fromKey: string, toKey: string): number {
  const toUtc = (k: string) => {
    const [y, m, d] = k.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(toKey) - toUtc(fromKey)) / 86_400_000);
}

export function dDayLabel(days: number): string {
  return days === 0 ? "D-DAY" : days > 0 ? `D-${days}` : `D+${-days}`;
}

// 정렬·비교용 시각 (시간 미정 날짜만 있는 경기는 그날 끝으로)
export function matchSortTime(m: ScheduleMatch): number {
  if (m.startAt) return new Date(m.startAt).getTime();
  const [y, mo, d] = m.dateOnly!.split("-").map(Number);
  return new Date(y, mo - 1, d, 23, 59).getTime();
}
