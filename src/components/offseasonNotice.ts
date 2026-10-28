import type { ScheduleMatch } from "@/lib/schedule";

// 예정 경기가 없는 팀 카드에 어떤 안내를 낼지 정한다 (화면 문구는 OffSeason.tsx 가 고른다)

// 리그별 새 시즌이 보통 시작하는 달 (비시즌 안내용 어림값)
export const SEASON_START_MONTH: Record<string, number> = {
  kbo: 3,
  "k-league-1": 2,
  "k-league-2": 3,
  kbl: 10,
  lck: 1,
  epl: 8,
  laliga: 8,
  bundesliga: 8,
  "serie-a": 8,
  "ligue-1": 8,
  nba: 10,
  nhl: 10,
  mlb: 3,
  nfl: 9,
  f1: 3,
};

// 리그 일정이 끝난 뒤 국제 대회가 이어지는 리그와 그 달 (1~12월).
// LCK: 2~3월 LCK 컵 뒤 퍼스트 스탠드, 6~7월 MSI, 8~10월 정규 시즌 뒤 월즈. 국제 대회 일정이 아직 안 올라온 동안 '시즌 종료'라 하지 않는다
const FOLLOW_UP_MONTHS: Record<string, number[]> = {
  lck: [2, 3, 6, 7, 8, 9, 10],
};

// 포스트시즌 경기 ('@postseason', '@series:kbo_ks|@game:3', '@playoffs:2|@game:5', '@lol:playoffs')
const POSTSEASON_RE = /(^|\|)@(postseason|series:|playoffs|lol:playoffs)/;
// 포스트시즌 라운드 사이(모든 시리즈가 끝나고 다음 라운드 일정이 아직 없음)로 보는 기간
const POSTSEASON_GAP_MS = 7 * 86_400_000;

export type OffSeasonNotice =
  | { kind: "ongoing"; competition: string } // 마지막 경기를 치른 대회에 남은 경기가 있다 (월즈 진행 중 등)
  | { kind: "national" } // 국가대표: 시즌이 없다 → '예정된 A매치 없음'
  | { kind: "postseason" } // 포스트시즌을 치른 지 얼마 안 됐다 → 다음 라운드일 수도, 시즌이 끝났을 수도
  | { kind: "followUp" } // 리그 일정은 끝났고 국제 대회가 이어질 수 있다
  | { kind: "seasonOver" } // 시즌 종료
  | { kind: "none" }; // 최근 경기도 없다 → '예정된 경기 없음'

export function offSeasonNotice({
  last,
  competition,
  competitionType,
  isOngoing,
  now,
}: {
  last: ScheduleMatch | undefined;
  competition: string | null; // 팀의 리그
  competitionType: string | null; // 그 리그의 종류 (국가대표는 'intl')
  isOngoing: (competition: string) => boolean;
  now: Date;
}): OffSeasonNotice {
  if (last && isOngoing(last.competition)) return { kind: "ongoing", competition: last.competition };
  if (competitionType === "intl") return { kind: "national" };
  if (!last) return { kind: "none" };
  const lastAt = last.startAt ? new Date(last.startAt).getTime() : new Date(`${last.dateOnly}T12:00:00Z`).getTime();
  // LCK 결승 직후처럼 국제 대회가 이어지는 때는 '다음 라운드'보다 국제 대회 안내가 맞다 (LCK 플레이오프 대진은 미정으로 미리 올라와 '진행 중'으로 잡힌다)
  if (competition && FOLLOW_UP_MONTHS[competition]?.includes(now.getMonth() + 1)) return { kind: "followUp" };
  if (POSTSEASON_RE.test(last.roundLabel ?? "") && now.getTime() - lastAt < POSTSEASON_GAP_MS) return { kind: "postseason" };
  return { kind: "seasonOver" };
}
