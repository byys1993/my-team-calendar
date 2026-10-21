import type { Fetcher, SourceAdapter, SourceMatch, SourceTeam } from "../types";
import { getJson, sleep } from "./http";

// LoL Esports 비공식 API (lolesports.com 사이트가 쓰는 공개 키). externalId 는 리그 ID.
// 일정은 '지금' 근처 한 페이지씩 주고, 앞뒤 페이지는 pageToken 으로 넘긴다.
const BASE = "https://esports-api.lolesports.com/persisted/gw";
const PUBLIC_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z";
const MAX_NEWER_PAGES = 10;

interface LolTeam {
  name: string;
  code: string;
}
export interface LolEvent {
  startTime: string;
  state: string; // unstarted | inProgress | completed
  type: string; // match | show
  blockName?: string;
  match?: { id: string; teams: LolTeam[]; strategy?: { type: string; count: number } };
}
interface SchedulePage {
  data: { schedule: { pages: { older: string | null; newer: string | null }; events: LolEvent[] } };
}

const FORMAT_KO: Record<number, string> = { 1: "단판", 3: "3판 2선승", 5: "5판 3선승" };

// 대진 미정 팀은 code 'TBD' 로 온다. 팀 ID가 없어 팀 약칭(code)을 소스 팀 ID로 쓴다.
const toTeam = (t?: LolTeam): SourceTeam | null =>
  t && t.code && t.code.toUpperCase() !== "TBD" ? { externalId: t.code, name: t.name } : null;

export function parseLolEvent(e: LolEvent): SourceMatch | null {
  if (e.type !== "match" || !e.match) return null;
  const [t1, t2] = e.match.teams;
  const home = toTeam(t1);
  const away = toTeam(t2);
  const count = e.match.strategy?.count;
  const format = count ? (FORMAT_KO[count] ?? `${count}판`) : null;
  return {
    externalId: e.match.id,
    season: e.startTime.slice(0, 4),
    roundLabel: [e.blockName, format].filter(Boolean).join(" · ") || null,
    home,
    away,
    homePlaceholder: home ? null : "미정",
    awayPlaceholder: away ? null : "미정",
    startAt: new Date(e.startTime).toISOString(),
    status: home && away ? "scheduled" : "draw_pending",
    // e스포츠는 홈·원정 개념이 없다
    isNeutral: true,
  };
}

export function lolesports(fetcher: Fetcher = fetch, opts: { apiKey?: string; delayMs?: number } = {}): SourceAdapter {
  const headers = { "x-api-key": opts.apiKey ?? PUBLIC_KEY };
  const delayMs = opts.delayMs ?? 300;
  const page = (leagueId: string, token?: string) =>
    getJson<SchedulePage>(
      fetcher,
      `${BASE}/getSchedule?hl=ko-KR&leagueId=${encodeURIComponent(leagueId)}${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`,
      headers,
    );

  async function collect(leagueId: string, full: boolean): Promise<SourceMatch[]> {
    const byId = new Map<string, SourceMatch>();
    const add = (p: SchedulePage) => {
      for (const e of p.data.schedule.events) {
        const m = parseLolEvent(e);
        if (m) byId.set(m.externalId, m);
      }
    };
    const first = await page(leagueId);
    add(first);
    if (full) {
      // 앞으로의 일정은 끝까지, 지난 일정은 한 페이지만 더
      let token = first.data.schedule.pages.newer;
      for (let i = 0; token && i < MAX_NEWER_PAGES; i++) {
        await sleep(delayMs);
        const p = await page(leagueId, token);
        add(p);
        token = p.data.schedule.pages.newer;
      }
      const older = first.data.schedule.pages.older;
      if (older) {
        await sleep(delayMs);
        add(await page(leagueId, older));
      }
    }
    return [...byId.values()];
  }

  return {
    source: "lolesports",
    fetchMatches: (leagueId) => collect(leagueId, true),
    fetchRecent: (leagueId) => collect(leagueId, false),
  };
}
