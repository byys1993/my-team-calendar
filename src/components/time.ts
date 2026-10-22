import type { ScheduleMatch } from "@/lib/schedule";

// 날짜·시각은 사용자가 고른 시간대(tz, 기본은 브라우저 시간대)로, 표기 방식은 화면 언어(intl)로 보여준다.
// (서버 렌더링 시점에는 쓰지 않는다)

const cache = new Map<string, Intl.DateTimeFormat>();
function dtf(intl: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = intl + JSON.stringify(opts);
  if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat(intl, opts));
  return cache.get(key)!;
}

// 영어는 오전/오후(12시간제), 나머지 언어는 스포츠 일정에서 흔한 24시간제(18:30)
const clock = (intl: string): Intl.DateTimeFormatOptions =>
  intl.startsWith("en") ? { hour: "numeric", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };

const utcOf = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

// 'YYYY-MM-DD' 만들기·나누기 (달력 칸은 시간대와 무관하게 숫자로 만든다)
export const keyOf = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
export const keyParts = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m: m - 1, d };
};

// 그 순간이 tz 에서 며칠인지 'YYYY-MM-DD'
export function toDateKey(d: Date, tz: string): string {
  return dtf("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz }).format(d);
}

export function matchDateKey(m: ScheduleMatch, tz: string): string {
  return m.startAt ? toDateKey(new Date(m.startAt), tz) : m.dateOnly!;
}

export function hasExactTime(m: ScheduleMatch): boolean {
  return !!m.startAt && m.status !== "time_tbd";
}

// 시각, 시간 미정이면 tbdText
export function matchTimeLabel(m: ScheduleMatch, intl: string, tbdText: string, tz: string): string {
  return hasExactTime(m) ? dtf(intl, { ...clock(intl), timeZone: tz }).format(new Date(m.startAt!)) : tbdText;
}

// '10월 24일 (토)', 'Sat, Oct 24' 처럼 그 언어 방식의 날짜 (날짜 키 자체라 시간대와 무관)
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

export function updatedLabel(iso: string, intl: string, tz: string): string {
  return dtf(intl, { month: "short", day: "numeric", ...clock(intl), timeZone: tz }).format(new Date(iso));
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
