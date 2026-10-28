import type { Fetcher, MatchStatus, SourceAdapter, SourceMatch } from "../types";
import { getJson, sleep } from "./http";

// NHL 공개 API (api-web.nhle.com, 비공식 문서). 키 없이 동작한다.
// 전체: 팀별 시즌 일정(32회), 경기 당일: 이번 주 일정(1회)
const BASE = "https://api-web.nhle.com/v1";

interface NhlTeam {
  id: number;
  abbrev: string;
  score?: number;
  placeName?: { default: string };
  commonName?: { default: string };
}
interface NhlGame {
  id: number;
  season: number;
  gameType: number; // 1 프리시즌, 2 정규시즌, 3 플레이오프
  startTimeUTC: string;
  gameScheduleState: string;
  gameState?: string; // FUT 예정, LIVE 진행 중, FINAL·OFF 끝남
  venue?: { default: string };
  neutralSite?: boolean;
  ifNecessary?: boolean;
  seriesStatus?: { round?: number; gameNumberOfSeries?: number };
  homeTeam: NhlTeam;
  awayTeam: NhlTeam;
  gameOutcome?: { lastPeriodType?: string; otPeriods?: number };
}

const STATE: Record<string, MatchStatus> = { PPD: "postponed", SUSP: "postponed", CNCL: "cancelled", TBD: "time_tbd" };

const teamName = (t: NhlTeam) =>
  [t.placeName?.default, t.commonName?.default].filter(Boolean).join(" ") || t.abbrev;

export function parseNhlGame(g: NhlGame): SourceMatch | null {
  if (g.gameType !== 2 && g.gameType !== 3) return null;
  let status = STATE[g.gameScheduleState] ?? "scheduled";
  if (status === "scheduled" && g.ifNecessary) status = "conditional";
  const s = String(g.season);
  const round = g.seriesStatus?.round;
  const gameNo = g.seriesStatus?.gameNumberOfSeries;
  return {
    externalId: String(g.id),
    season: `${s.slice(0, 4)}-${s.slice(6, 8)}`,
    roundLabel:
      g.gameType === 3 ? `${round ? `@playoffs:${round}` : "@playoffs"}${gameNo ? `|@game:${gameNo}` : ""}` : null,
    home: { externalId: String(g.homeTeam.id), name: teamName(g.homeTeam) },
    away: { externalId: String(g.awayTeam.id), name: teamName(g.awayTeam) },
    startAt: new Date(g.startTimeUTC).toISOString(),
    status,
    venue: g.venue?.default ?? null,
    isNeutral: g.neutralSite ?? false,
    ...(g.gameState === "FINAL" || g.gameState === "OFF"
      ? { homeScore: g.homeTeam.score ?? null, awayScore: g.awayTeam.score ?? null, ...nhlExtra(g.gameOutcome) }
      : {}),
  };
}

// 연장(OT)·슛아웃(SO)으로 끝난 경기
function nhlExtra(o?: NhlGame["gameOutcome"]): { extra?: string } {
  if (o?.lastPeriodType === "SO") return { extra: "so" };
  if (o?.lastPeriodType === "OT") return { extra: (o.otPeriods ?? 1) > 1 ? `ot:${o.otPeriods}` : "ot" };
  return {};
}

function collect(games: NhlGame[], into: Map<string, SourceMatch>) {
  for (const g of games) {
    const m = parseNhlGame(g);
    if (m) into.set(m.externalId, m);
  }
}

export function nhl(fetcher: Fetcher = fetch, delayMs = 250): SourceAdapter {
  return {
    source: "nhl",
    async fetchMatches() {
      const standings = await getJson<{ standings: { teamAbbrev: { default: string } }[] }>(
        fetcher,
        `${BASE}/standings/now`,
      );
      const byId = new Map<string, SourceMatch>();
      for (const s of standings.standings) {
        const abbr = encodeURIComponent(s.teamAbbrev.default);
        const sched = await getJson<{ games: NhlGame[] }>(fetcher, `${BASE}/club-schedule-season/${abbr}/now`);
        collect(sched.games, byId);
        if (delayMs) await sleep(delayMs);
      }
      return [...byId.values()];
    },
    async fetchRecent() {
      const week = await getJson<{ gameWeek: { games: NhlGame[] }[] }>(fetcher, `${BASE}/schedule/now`);
      const byId = new Map<string, SourceMatch>();
      for (const d of week.gameWeek) collect(d.games, byId);
      return [...byId.values()];
    },
  };
}
