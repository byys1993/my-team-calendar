import type { Fetcher, MatchStatus, SourceAdapter, SourceMatch } from "../types";
import { getJson } from "./http";

// MLB Stats API (statsapi.mlb.com). 요청 한 번에 기간 전체 일정을 받는다.
// 응답 문구상 개인·비상업·비대량 이용만 허용되므로 하루 몇 번 일정만 받는다.
interface MlbGame {
  gamePk: number;
  gameDate: string;
  officialDate: string;
  season: string;
  gameType: string;
  seriesDescription?: string;
  seriesGameNumber?: number;
  ifNecessary?: string;
  status: { detailedState: string; abstractGameState?: string; startTimeTBD?: boolean };
  teams: {
    home: { team: { id: number; name: string }; score?: number };
    away: { team: { id: number; name: string }; score?: number };
  };
  venue?: { name?: string };
}

// R 정규시즌, F 와일드카드, D 디비전시리즈, L 챔피언십시리즈, W 월드시리즈
const GAME_TYPES = "R,F,D,L,W";

// 시리즈 이름 → 언어 중립 토큰 키 (src/i18n/format.ts)
const SERIES_KEY: Record<string, string> = {
  "World Series": "ws",
  "AL Championship Series": "alcs",
  "NL Championship Series": "nlcs",
  "AL Division Series": "alds",
  "NL Division Series": "nlds",
  "AL Wild Card Series": "alwc",
  "NL Wild Card Series": "nlwc",
};

function status(g: MlbGame): MatchStatus {
  const s = g.status.detailedState;
  if (/postponed|suspended/i.test(s)) return "postponed";
  if (/cancel/i.test(s)) return "cancelled";
  // 포스트시즌 5~7차전처럼 시리즈가 끝나지 않으면 열리는 경기
  if (g.ifNecessary === "Y") return "conditional";
  if (g.status.startTimeTBD) return "time_tbd";
  return "scheduled";
}

export function parseMlb(json: { dates: { games: MlbGame[] }[] }): SourceMatch[] {
  return json.dates.flatMap((d) =>
    d.games.map((g): SourceMatch => {
      const st = status(g);
      // 시간 미정 경기의 gameDate 는 임의 시각이라 날짜만 쓴다
      const tbd = !!g.status.startTimeTBD;
      const key = g.seriesDescription ? SERIES_KEY[g.seriesDescription] : undefined;
      const series = key ? `@series:${key}` : g.seriesDescription ? `@t:${g.seriesDescription}` : "@postseason";
      return {
        externalId: String(g.gamePk),
        season: g.season,
        roundLabel: g.gameType === "R" ? null : `${series}${g.seriesGameNumber ? `|@game:${g.seriesGameNumber}` : ""}`,
        home: { externalId: String(g.teams.home.team.id), name: g.teams.home.team.name },
        away: { externalId: String(g.teams.away.team.id), name: g.teams.away.team.name },
        startAt: tbd ? null : new Date(g.gameDate).toISOString(),
        dateOnly: tbd ? g.officialDate : null,
        status: st === "scheduled" && tbd ? "time_tbd" : st,
        venue: g.venue?.name ?? null,
        ...(g.status.abstractGameState === "Final" && !/postponed|suspended|cancel/i.test(g.status.detailedState)
          ? { homeScore: g.teams.home.score ?? null, awayScore: g.teams.away.score ?? null }
          : {}),
      };
    }),
  );
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export function mlb(fetcher: Fetcher = fetch, now = () => new Date()): SourceAdapter {
  const fetchRange = async (sportId: string, fromDays: number, toDays: number) => {
    const t = now().getTime();
    const url =
      `https://statsapi.mlb.com/api/v1/schedule?sportId=${encodeURIComponent(sportId)}&gameType=${GAME_TYPES}` +
      `&startDate=${day(new Date(t + fromDays * 86_400_000))}&endDate=${day(new Date(t + toDays * 86_400_000))}` +
      "&hydrate=venue";
    return parseMlb(await getJson(fetcher, url));
  };
  return {
    source: "mlb",
    // 지난 60일 ~ 앞으로 400일 (다음 시즌 일정이 발표돼 있으면 함께 받는다)
    fetchMatches: (sportId) => fetchRange(sportId, -60, 400),
    fetchRecent: (sportId) => fetchRange(sportId, -1, 2),
  };
}
