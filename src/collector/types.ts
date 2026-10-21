export type MatchStatus = "scheduled" | "time_tbd" | "conditional" | "draw_pending" | "postponed" | "cancelled";

export interface SourceTeam {
  externalId: string;
  name: string;
  shortName?: string;
}

// 모든 소스의 응답을 이 형태로 바꾼 뒤 저장한다.
export interface SourceMatch {
  externalId: string;
  season: string;
  roundLabel?: string | null;
  home: SourceTeam | null;
  away: SourceTeam | null;
  homePlaceholder?: string | null;
  awayPlaceholder?: string | null;
  // ISO 8601 UTC. 시간이 미정이어도 잠정 시각이 있으면 넣는다.
  startAt: string | null;
  dateOnly?: string | null;
  status: MatchStatus;
  venue?: string | null;
  isNeutral?: boolean;
}

export interface SourceAdapter {
  source: string;
  // externalId: competition_source_ref.external_id (예: football-data 'PL', espn 'soccer/eng.1')
  fetchMatches(externalId: string): Promise<SourceMatch[]>;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
