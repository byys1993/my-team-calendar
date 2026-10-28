"use client";

import { useI18n } from "@/i18n/client";
import { formatLabel } from "@/i18n/format";
import type { ScheduleMatch } from "@/lib/schedule";
import { offSeasonNotice, SEASON_START_MONTH, type OffSeasonNotice } from "./offseasonNotice";
import { MatchResult } from "./spoiler";
import { dateLabel, matchDateKey } from "./time";
import { useTz } from "./timezone";

// 예정 경기가 없는 팀의 카드: 마지막 경기와 안내 (어떤 안내인지는 offseasonNotice.ts 가 정한다)
//   진행 중: '월즈 진행 중 · 다음 경기가 정해지면 추가 · 탈락했다면 다음 시즌은 ○월'
//   국가대표: '예정된 A매치 없음', 포스트시즌 직후: '다음 일정 대기 중', LCK 시즌 뒤: '리그 일정 종료 · 국제 대회 나가는 팀은…'
export function OffSeason({
  team,
  last,
  competition,
  competitionType,
  ongoingName,
}: {
  team: string;
  last: ScheduleMatch | undefined;
  competition: string | null;
  competitionType: string | null;
  ongoingName: (competition: string) => string | null; // 진행 중인 대회면 그 이름
}) {
  const { m, t: fmt, intl } = useI18n();
  const tz = useTz();
  const month = competition ? SEASON_START_MONTH[competition] : undefined;
  const monthName = month ? new Intl.DateTimeFormat(intl, { month: "long" }).format(new Date(Date.UTC(2026, month - 1, 15))) : null;
  // 상대 이름은 경기에 저장된 이름 (팀 목록에 없는 해외 팀도 이름이 나오도록)
  const opponent = last && !(last.title && !last.away) ? formatLabel(last.home === team ? last.awayLabel : last.homeLabel, m) : null;
  const notice = offSeasonNotice({ last, competition, competitionType, isOngoing: (c) => ongoingName(c) != null, now: new Date() });
  // '…추가돼요. 아니라면 다음 시즌은 보통 3월에 시작해요.' (시작 달을 모르면 앞 문장만)
  const withMonth = (lead: string, tail: string) => (monthName ? `${lead} ${fmt(tail, { month: monthName })}` : lead);
  // 안내 종류별 [제목, 아랫줄]
  const text: Record<OffSeasonNotice["kind"], [string, string]> = {
    ongoing: [
      fmt(m.offseason.ongoing, { league: notice.kind === "ongoing" ? (ongoingName(notice.competition) ?? "") : "" }),
      withMonth(m.offseason.ongoingNext, m.offseason.ongoingOut),
    ],
    national: [m.offseason.national, m.offseason.nationalNext],
    postseason: [m.offseason.waiting, withMonth(m.offseason.postNext, m.offseason.ended)],
    followUp: [m.offseason.leagueOver, withMonth(m.offseason.intlNext, m.offseason.otherwise)],
    seasonOver: [m.offseason.title, monthName ? fmt(m.offseason.next, { month: monthName }) : m.offseason.nextGeneric],
    none: [m.app.noNext, monthName ? fmt(m.offseason.next, { month: monthName }) : m.offseason.nextGeneric],
  };
  const [title, next] = text[notice.kind];
  return (
    <div className="offseason">
      <div className="offseason-title">{title}</div>
      {last && (
        <div className="offseason-last">
          {m.offseason.last} · {dateLabel(matchDateKey(last, tz), intl)}
          {opponent && ` ${m.match.vs} ${opponent}`} <MatchResult match={last} team={team} />
        </div>
      )}
      <div className="muted offseason-next">{next}</div>
    </div>
  );
}
