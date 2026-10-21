import type { Fetcher, MatchStatus, SourceAdapter, SourceMatch } from "../types";
import { europeanSeason, getJson, sleep } from "./http";

// ESPN 비공식 API. 축구 scoreboard는 날짜 범위 조회가 막혀 있어서
// 리그 팀 목록(1회) + 팀별 남은 일정(팀 수만큼)을 받아 경기 ID로 합친다.
const BASE = "https://site.api.espn.com/apis/site/v2/sports";

interface EspnCompetitor {
  homeAway: "home" | "away";
  team: { id: string; displayName: string; shortDisplayName?: string };
}
export interface EspnEvent {
  id: string;
  date: string;
  timeValid?: boolean;
  season?: { year: number };
  competitions: {
    neutralSite?: boolean;
    venue?: { fullName?: string };
    competitors: EspnCompetitor[];
    status?: { type?: { name?: string } };
  }[];
}

const STATUS: Record<string, MatchStatus> = {
  STATUS_POSTPONED: "postponed",
  STATUS_CANCELED: "cancelled",
  STATUS_ABANDONED: "cancelled",
  STATUS_TBD: "time_tbd",
};

export function parseEspnEvent(e: EspnEvent): SourceMatch | null {
  const c = e.competitions[0];
  if (!c) return null;
  const home = c.competitors.find((x) => x.homeAway === "home");
  const away = c.competitors.find((x) => x.homeAway === "away");
  const toTeam = (x?: EspnCompetitor) =>
    x?.team?.id ? { externalId: x.team.id, name: x.team.displayName, shortName: x.team.shortDisplayName } : null;
  let status = STATUS[c.status?.type?.name ?? ""] ?? "scheduled";
  if (status === "scheduled" && e.timeValid === false) status = "time_tbd";
  return {
    externalId: e.id,
    season: e.season?.year ? String(e.season.year) : europeanSeason(e.date),
    home: toTeam(home),
    away: toTeam(away),
    homePlaceholder: home ? null : "미정",
    awayPlaceholder: away ? null : "미정",
    startAt: new Date(e.date).toISOString(),
    status,
    venue: c.venue?.fullName ?? null,
    isNeutral: c.neutralSite ?? false,
  };
}

export function espnSoccer(fetcher: Fetcher = fetch, delayMs = 250): SourceAdapter {
  return {
    source: "espn",
    async fetchMatches(path) {
      const teams = await getJson<{ sports: { leagues: { teams: { team: { id: string } }[] }[] }[] }>(
        fetcher,
        `${BASE}/${path}/teams`,
      );
      const ids = teams.sports[0]?.leagues[0]?.teams.map((t) => t.team.id) ?? [];
      const byId = new Map<string, SourceMatch>();
      for (const id of ids) {
        const sched = await getJson<{ events?: EspnEvent[] }>(fetcher, `${BASE}/${path}/teams/${id}/schedule?fixture=true`);
        for (const e of sched.events ?? []) {
          const m = parseEspnEvent(e);
          if (m) byId.set(m.externalId, m);
        }
        if (delayMs) await sleep(delayMs);
      }
      return [...byId.values()];
    },
  };
}
