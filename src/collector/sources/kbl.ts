import type { Fetcher, SourceAdapter, SourceMatch } from "../types";
import { normalizeBroadcast } from "./broadcast";
import { getJson } from "./http";

// KBL 공식 홈페이지(kbl.or.kr)가 쓰는 일정 데이터 (api.kbl.or.kr, 공식 공개 API 아님).
// 홈페이지가 보내는 헤더(Channel: WEB, TeamCode)가 있어야 응답한다. 요청 한 번에 기간 전체를 받는다.
const URL = "https://api.kbl.or.kr/match/list";
const HEADERS = {
  Channel: "WEB",
  TeamCode: "XX",
  "X-Requested-With": "XMLHttpRequest",
  lang: "ko",
  Referer: "https://www.kbl.or.kr/",
};

// KBL 1군 10개 구단 코드 (시드 team_source_ref 의 kbl 값과 같음). D리그·EASL 상대팀 등은 걸러낸다.
const CLUBS = new Set(["06", "10", "16", "35", "50", "55", "60", "64", "66", "70"]);

export interface KblGame {
  gmkey: string;
  gameDate: string; // YYYYMMDD
  gameStart: string | null; // HHMM (KST)
  gameNo: number;
  seasonGrade: number; // 1 = 1군, 2 = D리그
  seasonCategory: string; // R 정규시즌, PO 플레이오프, CP 챔피언결정전, EA EASL, OM 시범, AS 올스타
  seasonName1?: string; // '2026-2027'
  tcodeH: string;
  tcodeA: string;
  tnameH: string;
  tnameA: string;
  stadiumnameF?: string | null;
  stadiumname?: string | null;
  tv?: string | null; // 'tvN SPORTS'
  isEnded: number;
  scoreH: number | null;
  scoreA: number | null;
}

export type KblMatch = SourceMatch & { winner: string | null };

// 플레이오프 단계: PO 1~10번은 6강, 11~20번은 4강 (두 시리즈가 번호를 나눠 씀), CP 는 챔피언결정전
function stageOf(g: KblGame): { key: string; bestOf: number } | null {
  if (g.seasonCategory === "PO") return g.gameNo <= 10 ? { key: "kbl_6po", bestOf: 5 } : { key: "kbl_4po", bestOf: 5 };
  if (g.seasonCategory === "CP") return { key: "kbl_final", bestOf: 7 };
  return null;
}

const ymdToIso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

export function parseKbl(games: KblGame[]): KblMatch[] {
  const wanted = games.filter(
    (g) => g.seasonGrade === 1 && ["R", "PO", "CP"].includes(g.seasonCategory) && CLUBS.has(g.tcodeH) && CLUBS.has(g.tcodeA),
  );
  // 시리즈(단계 + 두 팀)별로 번호순 정렬해 'N차전'을 매긴다
  const series = new Map<string, KblGame[]>();
  for (const g of wanted) {
    const stage = stageOf(g);
    if (!stage) continue;
    const key = `${stage.key}:${[g.tcodeH, g.tcodeA].sort().join("-")}`;
    series.set(key, [...(series.get(key) ?? []), g]);
  }
  const gameIndex = new Map<string, number>();
  for (const list of series.values()) {
    list.sort((a, b) => a.gameNo - b.gameNo).forEach((g, i) => gameIndex.set(g.gmkey, i + 1));
  }

  const matches = wanted.map((g): KblMatch => {
    const stage = stageOf(g);
    const time = g.gameStart && /^\d{4}$/.test(g.gameStart) ? `${g.gameStart.slice(0, 2)}:${g.gameStart.slice(2)}` : null;
    const date = ymdToIso(g.gameDate);
    const [y1, y2] = (g.seasonName1 ?? "").split("-");
    const ended = g.isEnded === 1 && g.scoreH != null && g.scoreA != null;
    return {
      externalId: g.gmkey,
      season: y1 && y2 ? `${y1}-${y2.slice(2)}` : g.gameDate.slice(0, 4),
      roundLabel: stage ? `@series:${stage.key}|@game:${gameIndex.get(g.gmkey)}` : null,
      home: { externalId: g.tcodeH, name: g.tnameH },
      away: { externalId: g.tcodeA, name: g.tnameA },
      startAt: time ? new Date(`${date}T${time}:00+09:00`).toISOString() : null,
      dateOnly: time ? null : date,
      status: time ? "scheduled" : "time_tbd",
      venue: g.stadiumnameF || g.stadiumname || null,
      broadcast: normalizeBroadcast(g.tv),
      winner: ended ? (g.scoreH! > g.scoreA! ? g.tcodeH : g.tcodeA) : null,
    };
  });
  return markKblConditional(matches, series);
}

// 시리즈가 먼저 끝나면 열리지 않는 경기를 '진출 시'로 표시한다 (KBO 와 같은 규칙, 6강·4강 5전 3선승, 챔프전 7전 4선승).
// N차전은 '지금까지 치른 경기 수 + 앞선 팀이 이기려면 더 필요한 승수' 안이면 반드시 열린다.
function markKblConditional(matches: KblMatch[], series: Map<string, KblGame[]>): KblMatch[] {
  const byId = new Map(matches.map((m) => [m.externalId, m]));
  for (const list of series.values()) {
    const bestOf = stageOf(list[0])!.bestOf;
    const needed = Math.ceil(bestOf / 2);
    const wins = new Map<string, number>();
    let played = 0;
    for (const g of list) {
      const w = byId.get(g.gmkey)!.winner;
      if (!w) continue;
      played++;
      wins.set(w, (wins.get(w) ?? 0) + 1);
    }
    const certainUpTo = played + (needed - Math.max(0, ...wins.values()));
    list.forEach((g, i) => {
      const m = byId.get(g.gmkey)!;
      if (!m.winner && i + 1 > certainUpTo) m.status = "conditional";
    });
  }
  return matches;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

export function kbl(fetcher: Fetcher = fetch, now = () => new Date()): SourceAdapter {
  return {
    source: "kbl",
    // 지난 60일 ~ 앞으로 300일 (시즌 전체). 요청 한 번이라 경기 당일에도 같은 범위를 받는다.
    async fetchMatches() {
      const t = now().getTime();
      const from = ymd(new Date(t - 60 * 86_400_000));
      const to = ymd(new Date(t + 300 * 86_400_000));
      const games = await getJson<KblGame[]>(fetcher, `${URL}?fromDate=${from}&toDate=${to}`, HEADERS);
      if (!Array.isArray(games)) throw new Error("KBL 응답 형식이 바뀌었습니다");
      return parseKbl(games).map((m) => {
        const out: SourceMatch & { winner?: string | null } = { ...m };
        delete out.winner;
        return out;
      });
    },
  };
}
