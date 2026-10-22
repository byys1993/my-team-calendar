import type { ScheduleMatch } from "@/lib/schedule";

// 모든 표시는 사용자 브라우저 시간대 기준이고, 날짜·요일·시각 표기는 화면 언어(intl)를 따른다.
// (서버 렌더링 시점에는 쓰지 않는다)

export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const dateKeyFmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });

const cache = new Map<string, Intl.DateTimeFormat>();
function dtf(intl: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = intl + JSON.stringify(opts);
  if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat(intl, opts));
  return cache.get(key)!;
}

const utcOf = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

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

// 시각, 시간 미정이면 tbdText
export function matchTimeLabel(m: ScheduleMatch, intl: string, tbdText: string): string {
  return hasExactTime(m) ? dtf(intl, { hour: "numeric", minute: "2-digit" }).format(new Date(m.startAt!)) : tbdText;
}

// '10월 24일 (토)', 'Sat, Oct 24' 처럼 그 언어 방식의 날짜
export function dateLabel(key: string, intl: string): string {
  return dtf(intl, { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" }).format(utcOf(key));
}

export function monthLabel(year: number, month: number, intl: string): string {
  return dtf(intl, { year: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, month, 1)));
}

// 일요일부터 토요일까지 짧은 요일 이름
export function weekdayNames(intl: string): string[] {
  const f = dtf(intl, { weekday: "short", timeZone: "UTC" });
  // 2026-10-04 는 일요일
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2026, 9, 4 + i))));
}

export function updatedLabel(iso: string, intl: string): string {
  return dtf(intl, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((utcOf(toKey).getTime() - utcOf(fromKey).getTime()) / 86_400_000);
}

export function dDayLabel(days: number, ddayText: string): string {
  return days === 0 ? ddayText : days > 0 ? `D-${days}` : `D+${-days}`;
}

// 정렬·비교용 시각 (시간 미정 날짜만 있는 경기는 그날 끝으로)
export function matchSortTime(m: ScheduleMatch): number {
  if (m.startAt) return new Date(m.startAt).getTime();
  const [y, mo, d] = m.dateOnly!.split("-").map(Number);
  return new Date(y, mo - 1, d, 23, 59).getTime();
}
