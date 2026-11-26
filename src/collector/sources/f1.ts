import type { Fetcher, Podium, SourceAdapter, SourceMatch, SourceTeam } from "../types";
import { getJsonRetry, sleep } from "./http";

// F1 세션은 모두 '시리즈'(시드의 f1 팀)의 이벤트로 저장한다. 그랑프리의 연습·예선·스프린트 예선·스프린트·결승.
// 사용자는 시리즈 전체나 팀·드라이버를 고른다 (src/lib/f1picks.ts). 팀·드라이버의 순위는 results(전체 순위)에서 찾는다.
const SERIES: SourceTeam = { externalId: "f1", name: "Formula 1" };

// 세션 → 제목 토큰의 세션 이름. 경기 ID에는 기존 짧은 이름(quali)을 그대로 쓴다.
const SESSION = {
  race: "race",
  quali: "qualifying",
  sprint: "sprint",
  fp1: "fp1",
  fp2: "fp2",
  fp3: "fp3",
  sq: "sprint_qualifying",
} as const;
type SessionKind = keyof typeof SESSION;

// 제목은 '@f1:<영문 그랑프리 이름>:<세션>' 토큰으로 저장하고 화면에서 그 언어로 바꾼다 (src/i18n/format.ts)
const f1Title = (gp: string, kind: SessionKind) => `@f1:${gp}:${SESSION[kind]}`;

// --- Jolpica (Ergast 호환) https://github.com/jolpica/jolpica-f1
interface JolpicaSession {
  date: string;
  time?: string;
}
interface JolpicaRace extends JolpicaSession {
  season: string;
  round: string;
  raceName: string;
  Circuit: { circuitName: string };
  Qualifying?: JolpicaSession;
  Sprint?: JolpicaSession;
  FirstPractice?: JolpicaSession;
  SecondPractice?: JolpicaSession;
  ThirdPractice?: JolpicaSession;
  SprintQualifying?: JolpicaSession;
  SprintShootout?: JolpicaSession; // 2023년 스프린트 예선 이름
}

function session(race: JolpicaRace, kind: SessionKind, s: JolpicaSession): SourceMatch {
  const hasTime = !!s.time;
  return {
    externalId: `${race.season}-${race.round}-${kind}`,
    season: race.season,
    roundLabel: `@round:${race.round}`,
    title: f1Title(race.raceName, kind),
    home: SERIES,
    away: null,
    startAt: hasTime ? new Date(`${s.date}T${s.time}`).toISOString() : null,
    dateOnly: hasTime ? null : s.date,
    status: hasTime ? "scheduled" : "time_tbd",
    venue: race.Circuit.circuitName,
  };
}

export function parseJolpica(races: JolpicaRace[]): SourceMatch[] {
  return races.flatMap((r) => {
    const other: [SessionKind, JolpicaSession | undefined][] = [
      ["quali", r.Qualifying],
      ["sprint", r.Sprint],
      ["fp1", r.FirstPractice],
      ["fp2", r.SecondPractice],
      ["fp3", r.ThirdPractice],
      ["sq", r.SprintQualifying ?? r.SprintShootout],
    ];
    return [session(r, "race", r), ...other.flatMap(([kind, s]) => (s ? [session(r, kind, s)] : []))];
  });
}

interface JolpicaResult {
  position: string;
  Driver: { driverId: string; code?: string; familyName: string };
  Constructor: { name: string };
}
interface JolpicaResultRace {
  season: string;
  round: string;
  Results?: JolpicaResult[];
  SprintResults?: JolpicaResult[];
  QualifyingResults?: JolpicaResult[];
}
type ResultPage = { MRData: { total: string; RaceTable: { Races: JolpicaResultRace[] } } };

// 결과 요청 종류: 경로, 세션, 포디움(목록 표시)에 넣을 순위까지 (예선은 폴 포지션만)
const RESULT_QUERIES: { path: string; kind: SessionKind; podium: number }[] = [
  { path: "results", kind: "race", podium: 3 },
  { path: "sprint", kind: "sprint", podium: 3 },
  { path: "qualifying", kind: "quali", podium: 1 },
];
const PAGE = 100;
const MAX_PAGES = 12; // 시즌 24경기 × 22명 ≈ 530줄 → 6쪽

// 경기 ID('2026-17-race') → 전체 순위(results)와 포디움. 한 경기 결과가 두 쪽에 나뉘어 와도 합친다.
export function addResults(matches: SourceMatch[], results: { kind: SessionKind; races: JolpicaResultRace[] }[]) {
  const byId = new Map<string, Map<number, Podium>>();
  const podiumTop = new Map(RESULT_QUERIES.map((q) => [q.kind, q.podium]));
  const kindOf = new Map<string, SessionKind>();
  for (const { kind, races } of results) {
    for (const r of races) {
      const list = r.Results ?? r.SprintResults ?? r.QualifyingResults ?? [];
      const id = `${r.season}-${r.round}-${kind}`;
      kindOf.set(id, kind);
      const rows = byId.get(id) ?? new Map<number, Podium>();
      for (const x of list) {
        const pos = Number(x.position);
        if (!Number.isInteger(pos)) continue;
        rows.set(pos, {
          pos,
          driverId: x.Driver.driverId,
          code: x.Driver.code ?? null,
          name: x.Driver.familyName,
          team: x.Constructor.name,
        });
      }
      byId.set(id, rows);
    }
  }
  return matches.map((m) => {
    const rows = byId.get(m.externalId);
    if (!rows?.size) return m;
    const all = [...rows.values()].sort((a, b) => a.pos - b.pos);
    const top = podiumTop.get(kindOf.get(m.externalId)!) ?? 3;
    return { ...m, podium: all.filter((p) => p.pos <= top), results: all };
  });
}

export function jolpica(fetcher: Fetcher = fetch, opts: { delayMs?: number; retryWaitMs?: number } = {}): SourceAdapter {
  const delayMs = opts.delayMs ?? 300;
  const getJson = <T,>(url: string) => getJsonRetry<T>(fetcher, url, { waitMs: opts.retryWaitMs });
  const base = "https://api.jolpi.ca/ergast/f1";
  return {
    source: "jolpica",
    async fetchMatches(season) {
      const s = encodeURIComponent(season);
      const json = await getJson<{ MRData: { RaceTable: { Races: JolpicaRace[] } } }>(`${base}/${s}/races/?limit=100`);
      // 끝난 세션의 전체 순위 (결승·스프린트·예선). 한 쪽에 100줄씩이라 시즌 전체를 쪽을 넘기며 받는다.
      const results: { kind: SessionKind; races: JolpicaResultRace[] }[] = [];
      for (const q of RESULT_QUERIES) {
        for (let page = 0; page < MAX_PAGES; page++) {
          if (delayMs) await sleep(delayMs);
          const r = await getJson<ResultPage>(`${base}/${s}/${q.path}/?limit=${PAGE}&offset=${page * PAGE}`);
          results.push({ kind: q.kind, races: r.MRData.RaceTable.Races });
          if ((page + 1) * PAGE >= Number(r.MRData.total)) break;
        }
      }
      return addResults(parseJolpica(json.MRData.RaceTable.Races), results);
    },
  };
}

// --- OpenF1 https://openf1.org (키 없이 일정 조회 가능, 초당 3회)
interface OpenF1Session {
  session_key: number;
  session_name: string;
  date_start: string;
  meeting_key: number;
  circuit_short_name: string;
  year: number;
  is_cancelled?: boolean;
}
interface OpenF1Meeting {
  meeting_key: number;
  meeting_name: string;
}

const OPENF1_KIND: Record<string, SessionKind> = {
  Race: "race",
  Qualifying: "quali",
  Sprint: "sprint",
  "Practice 1": "fp1",
  "Practice 2": "fp2",
  "Practice 3": "fp3",
  "Sprint Qualifying": "sq",
  "Sprint Shootout": "sq",
};

export function parseOpenF1(sessions: OpenF1Session[], meetings: OpenF1Meeting[]): SourceMatch[] {
  const names = new Map(meetings.map((m) => [m.meeting_key, m.meeting_name]));
  return sessions
    .filter((s) => OPENF1_KIND[s.session_name])
    .map((s) => {
      const kind = OPENF1_KIND[s.session_name];
      const meeting = names.get(s.meeting_key) ?? s.circuit_short_name;
      return {
        externalId: String(s.session_key),
        season: String(s.year),
        title: f1Title(meeting, kind),
        home: SERIES,
        away: null,
        startAt: new Date(s.date_start).toISOString(),
        status: s.is_cancelled ? "cancelled" : "scheduled",
        venue: s.circuit_short_name,
      };
    });
}

export function openF1(
  fetcher: Fetcher = fetch,
  now = () => new Date(),
  opts: { delayMs?: number; retryWaitMs?: number } = {},
): SourceAdapter {
  // 초당 3회 제한이라 요청 사이를 조금 띄운다
  const delayMs = opts.delayMs ?? 400;
  const getJson = async <T,>(url: string) => {
    if (delayMs) await sleep(delayMs);
    return getJsonRetry<T>(fetcher, url, { waitMs: opts.retryWaitMs });
  };
  return {
    source: "openf1",
    async fetchMatches() {
      // 시즌 막바지에는 다음 시즌 일정이 먼저 올라오기도 하므로 올해와 내년을 함께 본다
      const year = now().getUTCFullYear();
      const result: SourceMatch[] = [];
      for (const y of [year, year + 1]) {
        const sessions = await getJson<OpenF1Session[]>(`https://api.openf1.org/v1/sessions?year=${y}`);
        if (sessions.length === 0) continue;
        const meetings = await getJson<OpenF1Meeting[]>(`https://api.openf1.org/v1/meetings?year=${y}`);
        result.push(...parseOpenF1(sessions, meetings));
      }
      return result;
    },
  };
}
