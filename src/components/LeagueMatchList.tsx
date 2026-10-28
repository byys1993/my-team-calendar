"use client";

import { useI18n } from "@/i18n/client";
import { formatLabel, formatTitle } from "@/i18n/format";
import { teamVars } from "@/lib/palette";
import type { ScheduleMatch } from "@/lib/schedule";
import { isEvent, isTentative } from "./matchView";
import { PodiumResult, ScoreResult } from "./spoiler";
import { isDawn, matchTimeLabel } from "./time";
import { useTz } from "./timezone";

// 어느 팀 기준도 아닌 리그 경기 목록 (같은 리그 다른 경기, 리그 일정 탭): 시각 · 홈 vs 원정 · 결과(스포일러 방지·기록) · 라운드
// mine: 내 팀 slug → 색. 내 팀 경기는 팀 색으로 강조한다
export function LeagueMatchList({ matches, mine }: { matches: ScheduleMatch[]; mine?: Map<string, number> }) {
  const { m: t, intl, locale } = useI18n();
  const tz = useTz();
  const label = (s: string) => formatLabel(s, t) ?? s;
  return (
    <ul className="league-day-list">
      {matches.map((x) => {
        const status = x.status === "scheduled" ? null : t.status[x.status];
        const round = formatLabel(x.roundLabel, t);
        const color = mine && [x.home, x.away].map((s) => (s ? mine.get(s) : undefined)).find((c) => c != null);
        const cls = [isTentative(x) && "tentative", color != null && "mine"].filter(Boolean).join(" ");
        return (
          <li key={x.id} className={cls || undefined} style={color != null ? (teamVars(color) as React.CSSProperties) : undefined}>
            <span className="ld-time">
              {isDawn(x, tz) && "🌙"}
              {matchTimeLabel(x, intl, t.match.timeTbd, tz)}
            </span>
            <span className="ld-what">
              <span className="ld-teams">
                {isEvent(x) ? formatTitle(x.title, t, locale) : `${label(x.homeLabel)} ${t.match.vs} ${label(x.awayLabel)}`}
              </span>
              {status && <span className="status">{status}</span>}
              {isEvent(x) ? <PodiumResult match={x} /> : <ScoreResult match={x} />}
              {round && !isEvent(x) && <span className="ld-meta muted">{round}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
