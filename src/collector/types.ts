export type MatchStatus = "scheduled" | "time_tbd" | "conditional" | "draw_pending" | "postponed" | "cancelled";

export interface SourceTeam {
  externalId: string;
  name: string;
  shortName?: string;
  // 시드에 없는 팀을 새로 만들 때 쓸 한국어 이름 (국가대표 상대국 등)
  nameKo?: string;
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
  // 국내 중계 채널 (예: 'SPOTV, 쿠팡플레이'). 공식 일정 데이터에 있을 때만.
  broadcast?: string | null;
  // 끝난 경기의 점수 (e스포츠는 세트 승수). 끝나지 않았으면 비워 둔다.
  homeScore?: number | null;
  awayScore?: number | null;
  // 승부차기 점수 (승부차기로 끝난 경기만)
  homePen?: number | null;
  awayPen?: number | null;
  // 정규 시간 안에 끝나지 않은 경기: 'ot' · 'ot:2'(2차 연장) · 'so'(슛아웃) · 'inn:12'(야구 연장 12회)
  extra?: string | null;
  // 순위 경기(F1)의 결과: 결승·스프린트는 1~3위, 예선은 폴 포지션
  podium?: Podium[] | null;
}

export interface Podium {
  pos: number;
  driverId: string;
  code: string | null;
  name: string; // 영문 성 (화면에서 한국어 이름으로 바꾼다)
  team: string;
}

// 출처가 빠짐없이 돌려준 기간 (from 포함, to 미포함, ISO 시각). 이 기간에 있던 이 출처의 끝나지 않은 경기가
// 응답에서 빠지면 출처가 지운 것으로 보고 정리한다. KBO 포스트시즌은 순연되면 옛 날짜 줄을 지우고
// 날짜가 든 새 경기 ID 로 다시 올린다.
export interface Coverage {
  from: string;
  to: string;
}
export type FetchResult = SourceMatch[] & { coverage?: Coverage[] };

export interface SourceAdapter {
  source: string;
  // externalId: competition_source_ref.external_id (예: football-data 'PL', espn 'soccer/eng.1')
  // 리그·시즌 전체 일정 (12시간마다)
  fetchMatches(externalId: string): Promise<FetchResult>;
  // 경기 당일 매시간 수집용: 최근 며칠 일정만. 없으면 fetchMatches 를 쓴다.
  fetchRecent?(externalId: string): Promise<FetchResult>;
  // 경기 ID에 날짜가 들어가 순연되면 ID가 바뀌는 출처 (KBO). 시리즈 N차전을 같은 경기로 이어 붙인다.
  datedIds?: boolean;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
