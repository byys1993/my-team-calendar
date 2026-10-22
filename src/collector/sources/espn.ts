import type { Fetcher, MatchStatus, SourceAdapter, SourceMatch } from "../types";
import { europeanSeason, getJson, sleep } from "./http";
import { nationKo } from "./nations";

// ESPN 비공식 API. externalId 는 'soccer/eng.1', 'basketball/nba' 같은 경로다.
// - 축구: scoreboard 날짜 범위 조회가 막혀 있어 리그 팀 목록 + 팀별 남은 일정을 받아 합친다.
// - 미국 리그: scoreboard 를 월 단위(YYYYMM)로 받는다. 경기 당일에는 어제~내일만 받는다.
const BASE = "https://site.api.espn.com/apis/site/v2/sports";

interface EspnCompetitor {
  homeAway: "home" | "away";
  team: { id: string; displayName: string; shortDisplayName?: string };
  // scoreboard 응답은 '2', 팀 일정 응답은 { value: 2, displayValue: '2' }
  score?: string | { value?: number; displayValue?: string };
}
export interface EspnEvent {
  id: string;
  league?: { slug?: string; name?: string };
  date: string;
  timeValid?: boolean;
  season?: { year: number; type?: number };
  week?: { number: number };
  competitions: {
    timeValid?: boolean;
    neutralSite?: boolean;
    venue?: { fullName?: string };
    competitors: EspnCompetitor[];
    status?: { type?: { name?: string; completed?: boolean } };
    notes?: { headline?: string }[];
  }[];
}

const STATUS: Record<string, MatchStatus> = {
  STATUS_POSTPONED: "postponed",
  STATUS_CANCELED: "cancelled",
  STATUS_ABANDONED: "cancelled",
  STATUS_TBD: "time_tbd",
};

const isSoccer = (path: string) => path.startsWith("soccer/");
const isNational = (id: string) => id.startsWith("team:");

// 국가대표 경기의 대회 구분 (ESPN 리그 slug → 라운드 토큰)
const INTL: Record<string, string> = {
  "fifa.friendly": "friendly",
  "fifa.world": "world_cup",
  "fifa.worldq.afc": "wcq",
  "afc.asian.cup": "asian_cup",
  "afc.cupq": "asian_cup_q",
  "eaff.championship": "eaff",
};
export function intlLabel(league?: { slug?: string; name?: string }): string | null {
  const key = league?.slug ? INTL[league.slug] : undefined;
  return key ? `@intl:${key}` : league?.name ? `@t:${league.name}` : null;
}

// 축구 팀 ID는 리그가 달라도 같은 팀이면 같지만, 미국 리그는 종목끼리 ID가 겹쳐서 'nba:1' 처럼 리그를 붙인다.
export function espnTeamId(path: string, id: string): string {
  return isSoccer(path) ? id : `${path.split("/")[1]}:${id}`;
}

export function parseEspnEvent(e: EspnEvent, path = "soccer/eng.1"): SourceMatch | null {
  const c = e.competitions[0];
  if (!c) return null;
  // 대진 미정 경기는 id -1, -2 의 'TBD' 팀으로 온다
  const toTeam = (x?: EspnCompetitor) =>
    x?.team?.id && !x.team.id.startsWith("-")
      ? { externalId: espnTeamId(path, x.team.id), name: x.team.displayName, shortName: x.team.shortDisplayName }
      : null;
  const home = toTeam(c.competitors.find((x) => x.homeAway === "home"));
  const away = toTeam(c.competitors.find((x) => x.homeAway === "away"));
  let status = STATUS[c.status?.type?.name ?? ""] ?? "scheduled";
  // 시간 미정 표시는 팀 일정 응답은 event 에, scoreboard 응답은 competition 에 있다
  const timeValid = e.timeValid ?? c.timeValid;
  if (status === "scheduled" && timeValid === false) status = "time_tbd";
  if ((!home || !away) && status !== "cancelled") status = "draw_pending";
  // season.type: 1 프리시즌, 2 정규시즌, 3 포스트시즌
  const note = c.notes?.[0]?.headline;
  const roundLabel = isSoccer(path)
    ? (note ?? null)
    : e.season?.type === 3
      ? (note ?? "@postseason")
      : (note ?? (e.week?.number ? `@week:${e.week.number}` : null));
  // 미국 리그의 시간 미정 경기는 미 동부 자정(05:00Z)으로 오므로 날짜만 쓴다
  const usDateOnly = !isSoccer(path) && timeValid === false;
  return {
    externalId: e.id,
    season: e.season?.year ? String(e.season.year) : europeanSeason(e.date),
    roundLabel,
    home,
    away,
    homePlaceholder: home ? null : "@tbd",
    awayPlaceholder: away ? null : "@tbd",
    startAt: usDateOnly ? null : new Date(e.date).toISOString(),
    dateOnly: usDateOnly ? new Date(new Date(e.date).getTime() - 5 * 3600_000).toISOString().slice(0, 10) : null,
    status,
    venue: c.venue?.fullName ?? null,
    isNeutral: c.neutralSite ?? false,
    ...(c.status?.type?.completed && status !== "cancelled" && status !== "postponed"
      ? {
          homeScore: scoreOf(c.competitors.find((x) => x.homeAway === "home")),
          awayScore: scoreOf(c.competitors.find((x) => x.homeAway === "away")),
        }
      : {}),
  };
}

function scoreOf(c?: EspnCompetitor): number | null {
  const v = typeof c?.score === "string" ? Number(c.score) : (c?.score?.value ?? Number(c?.score?.displayValue));
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

// 지난 2개월 ~ 앞으로 10개월 (시즌 전체를 덮는다)
export function monthRange(now: Date, before = 2, after = 10): string[] {
  const months: string[] = [];
  for (let i = -before; i <= after; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    months.push(ymd(d).slice(0, 6));
  }
  return months;
}

export function espn(fetcher: Fetcher = fetch, opts: { delayMs?: number; now?: () => Date } = {}): SourceAdapter {
  const delayMs = opts.delayMs ?? 250;
  const now = opts.now ?? (() => new Date());

  // 미국 리그: 날짜(YYYYMM 또는 YYYYMMDD)별 scoreboard. 프리시즌 경기는 뺀다.
  async function byDates(path: string, dates: string[]): Promise<SourceMatch[]> {
    const byId = new Map<string, SourceMatch>();
    for (const d of dates) {
      const json = await getJson<{ events?: EspnEvent[] }>(fetcher, `${BASE}/${path}/scoreboard?dates=${d}&limit=1000`);
      for (const e of json.events ?? []) {
        if (e.season?.type === 1) continue;
        const m = parseEspnEvent(e, path);
        if (m) byId.set(m.externalId, m);
      }
      if (delayMs) await sleep(delayMs);
    }
    return [...byId.values()];
  }

  // 'soccer/eng.fa|eng.1' 처럼 팀 목록을 가져올 리그를 따로 줄 수 있다.
  // 컵대회는 참가팀 목록이 비어 있거나(추첨 전) 하부리그 팀까지 수백 개라, 우리가 다루는 리그 팀만 본다.
  async function soccer(externalId: string): Promise<SourceMatch[]> {
    const [path, teamsFrom] = externalId.split("|");
    const teams = await getJson<{ sports: { leagues: { teams: { team: { id: string } }[] }[] }[] }>(
      fetcher,
      teamsFrom ? `${BASE}/soccer/${teamsFrom}/teams` : `${BASE}/${path}/teams`,
    );
    const ids = teams.sports[0]?.leagues[0]?.teams.map((t) => t.team.id) ?? [];
    const byId = new Map<string, SourceMatch>();
    // 남은 일정(fixture=true)과 이번 시즌 치른 경기(결과 포함)를 함께 받는다
    for (const id of ids) {
      for (const query of ["?fixture=true", ""]) {
        const sched = await getJson<{ events?: EspnEvent[] }>(fetcher, `${BASE}/${path}/teams/${id}/schedule${query}`);
        for (const e of sched.events ?? []) {
          const m = parseEspnEvent(e, path);
          if (m) byId.set(m.externalId, m);
        }
        if (delayMs) await sleep(delayMs);
      }
    }
    return [...byId.values()];
  }

  // 국가대표팀 ('team:451' = 대한민국): 남은 일정 + 올해 치른 경기. 상대국은 한국어 이름을 붙여 준다.
  async function national(externalId: string): Promise<SourceMatch[]> {
    const id = externalId.slice("team:".length);
    const byId = new Map<string, SourceMatch>();
    for (const q of ["fixture=true", `season=${now().getUTCFullYear()}`]) {
      const sched = await getJson<{ events?: EspnEvent[] }>(fetcher, `${BASE}/soccer/all/teams/${id}/schedule?${q}`);
      for (const e of sched.events ?? []) {
        const m = parseEspnEvent(e, "soccer/all");
        if (!m) continue;
        for (const t of [m.home, m.away]) if (t) t.nameKo = nationKo(t.name);
        byId.set(m.externalId, { ...m, season: e.date.slice(0, 4), roundLabel: intlLabel(e.league) });
      }
      if (delayMs) await sleep(delayMs);
    }
    return [...byId.values()];
  }

  return {
    source: "espn",
    fetchMatches: (path) =>
      isNational(path) ? national(path) : isSoccer(path) ? soccer(path) : byDates(path, monthRange(now())),
    fetchRecent: (path) => {
      if (isNational(path)) return national(path);
      if (isSoccer(path)) return soccer(path);
      const t = now().getTime();
      return byDates(path, [-1, 0, 1].map((d) => ymd(new Date(t + d * 86_400_000))));
    },
  };
}
