"use client";

import { formatLabel } from "@/i18n/format";
import { useI18n } from "@/i18n/client";
import { isTentative, type MatchView } from "./matchView";
import { dateLabel, matchDateKey, matchTimeLabel } from "./time";
import { useTz } from "./timezone";

interface Props {
  view: MatchView;
  teamName: (slug: string) => string;
  competitionName: (slug: string) => string;
  showDate?: boolean;
}

export function MatchRow({ view, teamName, competitionName, showDate = true }: Props) {
  const { m: t, intl } = useI18n();
  const tz = useTz();
  const m = view.match;
  const status = m.status === "scheduled" ? null : t.status[m.status];
  const round = formatLabel(m.roundLabel, t);
  return (
    <li
      className={`match-row${isTentative(m) ? " tentative" : ""}${m.status === "cancelled" ? " cancelled" : ""}`}
      style={{ "--team": view.color } as React.CSSProperties}
    >
      <div className="when">
        {showDate && <span className="date">{dateLabel(matchDateKey(m, tz), intl)}</span>}
        <span className="time">{matchTimeLabel(m, intl, t.match.timeTbd, tz)}</span>
      </div>
      <div className="what">
        <div className="teams">
          <strong>{teamName(view.team)}</strong>
          {view.side && <span className="vs">{t.match.vs}</span>}
          <span>{view.opponent}</span>
          {view.side && view.side !== "vs" && <span className={`side side-${view.side}`}>{t.match[view.side]}</span>}
          {status && <span className="status">{status}</span>}
        </div>
        <div className="meta">
          {competitionName(m.competition)}
          {round && ` · ${round}`}
          {m.venue && ` · ${m.venue}`}
        </div>
      </div>
    </li>
  );
}
