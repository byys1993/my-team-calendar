"use client";

import { isTentative, STATUS_LABEL, type MatchView } from "./matchView";
import { dateLabel, matchDateKey, matchTimeLabel } from "./time";

interface Props {
  view: MatchView;
  teamName: (slug: string) => string;
  competitionName: (slug: string) => string;
  showDate?: boolean;
}

export function MatchRow({ view, teamName, competitionName, showDate = true }: Props) {
  const m = view.match;
  const status = STATUS_LABEL[m.status];
  return (
    <li
      className={`match-row${isTentative(m) ? " tentative" : ""}${m.status === "cancelled" ? " cancelled" : ""}`}
      style={{ "--team": view.color } as React.CSSProperties}
    >
      <div className="when">
        {showDate && <span className="date">{dateLabel(matchDateKey(m))}</span>}
        <span className="time">{matchTimeLabel(m)}</span>
      </div>
      <div className="what">
        <div className="teams">
          <strong>{teamName(view.team)}</strong>
          <span className="vs">vs</span>
          <span>{view.opponent}</span>
          <span className={`side side-${view.side}`}>{view.side}</span>
          {status && <span className="status">{status}</span>}
        </div>
        <div className="meta">
          {competitionName(m.competition)}
          {m.roundLabel && ` · ${m.roundLabel}`}
          {m.venue && ` · ${m.venue}`}
        </div>
      </div>
    </li>
  );
}
