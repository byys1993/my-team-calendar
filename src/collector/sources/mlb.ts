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
  status: { detailedState: string; startTimeTBD?: boolean };
  teams: { home: { team: { id: number; name: string } }; away: { team: { id: number; name: string } } };
  venue?: { name?: string };
}

// R 정규시즌, F 와일드카드, D 디비전시리즈, L 챔피언십시리즈, W 월드시리즈
const GAME_TYPES = "R,F,D,L,W";

const SERIES_KO: Record<string, string> = {
  "World Series": "월드시리즈",
  "AL Championship Series": "ALCS",
  "NL Championship Series": "NLCS",
  "AL Division Series": "ALDS",
  "NL Division Series": "NLDS",
  "AL Wild Card Series": "AL 와일드카드",
  "NL Wild Card Series": "NL 와일드카드",
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
      const series = g.seriesDescription ? (SERIES_KO[g.seriesDescription] ?? g.seriesDescription) : null;
      return {
        externalId: String(g.gamePk),
        season: g.season,
        roundLabel: g.gameType === "R" ? null : `${series ?? "포스트시즌"}${g.seriesGameNumber ? ` ${g.seriesGameNumber}차전` : ""}`,
        home: { externalId: String(g.teams.home.team.id), name: g.teams.home.team.name },
        away: { externalId: String(g.teams.away.team.id), name: g.teams.away.team.name },
        startAt: tbd ? null : new Date(g.gameDate).toISOString(),
        dateOnly: tbd ? g.officialDate : null,
        status: st === "scheduled" && tbd ? "time_tbd" : st,
        venue: g.venue?.name ?? null,
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
