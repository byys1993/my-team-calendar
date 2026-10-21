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
  // 이벤트형 경기(F1 등)는 home 에 시리즈 팀, away 는 null, title 에 '호주 GP 결승' 같은 제목을 넣는다.
  title?: string | null;
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
  // 리그·시즌 전체 일정 (12시간마다)
  fetchMatches(externalId: string): Promise<SourceMatch[]>;
  // 경기 당일 매시간 수집용: 최근 며칠 일정만. 없으면 fetchMatches 를 쓴다.
  fetchRecent?(externalId: string): Promise<SourceMatch[]>;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
