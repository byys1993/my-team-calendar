import type { Locale } from "@/i18n/config";
import type { ScheduleMatch } from "@/lib/schedule";
import { involves } from "./matchView";
import { matchSortTime } from "./time";

// 첫 방문 예시 화면에 쓸 후보 팀 (앞에 있을수록 먼저). 이 중 앞으로 30일 안에 경기가 있는 팀을
// 종목이 겹치지 않게 3팀 고른다 → 계절이 바뀌어도 시즌 중인 팀이 저절로 나온다.
// 한국어: 해외 팀과 국내 리그(중계 채널이 보이는)를 섞어 '리그가 달라도 한 캘린더'를 보여 준다.
const KO = ["psg", "kbo-lg", "lck-t1", "kbl-sk", "vleague-heungkuk", "nba-lal", "mlb-lad", "real-madrid", "nfl-kc", "korea-national"];
const OTHER = ["real-madrid", "nba-lal", "nfl-kc", "mlb-lad", "lck-t1", "man-city", "bayern", "nhl-cgy", "psg"];

export const DEMO_TEAMS = 3;
const WINDOW_MS = 30 * 86_400_000;

export function demoCandidates(locale: Locale, known: (slug: string) => boolean): string[] {
  return (locale === "ko" ? KO : OTHER).filter(known);
}

export function pickDemo(
  matches: ScheduleMatch[],
  candidates: string[],
  sportOf: (slug: string) => string | undefined,
  nowMs: number,
): string[] {
  const picked: string[] = [];
  const sports = new Set<string>();
  for (const slug of candidates) {
    const sport = sportOf(slug);
    if (!sport || sports.has(sport)) continue;
    const soon = matches.some((m) => {
      if (m.status === "cancelled" || !involves(m, slug)) return false;
      const at = matchSortTime(m);
      return at >= nowMs && at <= nowMs + WINDOW_MS;
    });
    if (!soon) continue;
    picked.push(slug);
    sports.add(sport);
    if (picked.length === DEMO_TEAMS) break;
  }
  return picked;
}
