import type { FetchResult, Fetcher, SourceAdapter, SourceMatch } from "../types";
import { normalizeBroadcast } from "./broadcast";
import { getJson, SourceError } from "./http";

// 한국배구연맹 공식 홈페이지(kovo.co.kr)가 쓰는 데이터 (user-api.kovo.co.kr, 공식 공개 API 아님).
// 대회 외부 ID는 성별 코드 ('1' 남자부, '2' 여자부). 요청 한 번에 시즌 전체를 받는다.
const API = "https://user-api.kovo.co.kr";
// Accept-Language 가 없으면 팀 이름이 영어로 온다
const HEADERS = { "Accept-Language": "ko", Referer: "https://kovo.co.kr/" };

// 정규리그. 포스트시즌은 아래 STAGE, 그 밖의 코드(시범경기·올스타전 등)는 받지 않는다.
export const KOVO_REGULAR = "201";
// 준플레이오프 단판, 플레이오프 3전 2선승, 챔피언결정전 5전 3선승. 이름은 KBO·KBL 과 같은 말이라 같은 문구를 쓴다.
const STAGE: Record<string, { key: string; bestOf: number }> = {
  "204": { key: "kbo_semi", bestOf: 1 },
  "202": { key: "kbo_po", bestOf: 3 },
  "203": { key: "kbl_final", bestOf: 5 },
};

export interface KovoGame {
  seasonCode: string; // '023'
  seasonName?: string; // 'HK흥국금융 2026~2027 V-리그'
  leagueCode: string;
  round: number;
  gnum: number; // 시즌·리그 코드 안에서 남녀 통틀어 겹치지 않는 번호
  hcode: string;
  hname: string;
  hsname?: string;
  acode: string;
  aname: string;
  asname?: string;
  gdate: string; // YYYY-MM-DD
  gstime?: string | null; // HH:MM (KST)
  hspoint?: number | null; // 이긴 세트 수
  aspoint?: number | null;
  place?: string | null;
  gtv?: string | null; // 'KBSN Sports,NAVER,SOOP'
}

// 응답은 HTTP 200 이어도 본문의 result.status 가 실패일 수 있다
export async function kovoGet<T>(fetcher: Fetcher, path: string): Promise<T> {
  const body = await getJson<{ result?: { status?: number; message?: string }; payload?: T | null }>(fetcher, `${API}${path}`, HEADERS);
  if (body.result?.status !== 200 || body.payload == null) throw new SourceError(`KOVO ${body.result?.status ?? "응답 이상"} — ${path}`);
  return body.payload;
}

export const kovoSeason = async (fetcher: Fetcher) => (await kovoGet<{ seasonCode: string }>(fetcher, "/main/game/season")).seasonCode;

const seasonLabel = (g: KovoGame) => {
  const m = g.seasonName?.match(/(\d{4})~\d{2}(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : g.seasonCode;
};

// 끝난 경기는 한 팀이 3세트를 이긴 경기 (경기 중이면 아직 3이 아니다)
const winnerOf = (g: KovoGame) => {
  const h = g.hspoint ?? 0;
  const a = g.aspoint ?? 0;
  return h === 3 && a < 3 ? g.hcode : a === 3 && h < 3 ? g.acode : null;
};

export function parseKovo(games: KovoGame[]): SourceMatch[] {
  const wanted = games.filter((g) => (g.leagueCode === KOVO_REGULAR || STAGE[g.leagueCode]) && g.hcode && g.acode);
  // 포스트시즌 단계별로 번호순 정렬해 'N차전'을 매긴다 (남녀가 따로 오므로 단계마다 한 시리즈)
  const series = new Map<string, KovoGame[]>();
  for (const g of wanted) {
    if (STAGE[g.leagueCode]) series.set(g.leagueCode, [...(series.get(g.leagueCode) ?? []), g]);
  }
  const gameIndex = new Map<KovoGame, number>();
  // 시리즈가 먼저 끝나면 열리지 않는 경기 ('진출 시'). N차전은 '치른 경기 수 + 앞선 팀이 이기려면 더 필요한 승수' 안이면 반드시 열린다.
  const conditional = new Set<KovoGame>();
  for (const [code, list] of series) {
    list.sort((a, b) => a.gnum - b.gnum).forEach((g, i) => gameIndex.set(g, i + 1));
    const needed = Math.ceil(STAGE[code].bestOf / 2);
    const wins = new Map<string, number>();
    let played = 0;
    for (const g of list) {
      const w = winnerOf(g);
      if (!w) continue;
      played++;
      wins.set(w, (wins.get(w) ?? 0) + 1);
    }
    const certainUpTo = played + (needed - Math.max(0, ...wins.values()));
    list.forEach((g, i) => {
      if (!winnerOf(g) && i + 1 > certainUpTo) conditional.add(g);
    });
  }

  return wanted.map((g): SourceMatch => {
    const stage = STAGE[g.leagueCode];
    const time = g.gstime && /^\d{2}:\d{2}$/.test(g.gstime) ? g.gstime : null;
    const ended = winnerOf(g) != null;
    return {
      externalId: `${g.seasonCode}-${g.leagueCode}-${g.gnum}`,
      season: seasonLabel(g),
      roundLabel: stage ? `@series:${stage.key}|@game:${gameIndex.get(g)}` : `@round:${g.round}`,
      home: { externalId: g.hcode, name: g.hname, shortName: g.hsname },
      away: { externalId: g.acode, name: g.aname, shortName: g.asname },
      startAt: time ? new Date(`${g.gdate}T${time}:00+09:00`).toISOString() : null,
      dateOnly: time ? null : g.gdate,
      status: conditional.has(g) ? "conditional" : time ? "scheduled" : "time_tbd",
      venue: g.place || null,
      broadcast: normalizeBroadcast(g.gtv),
      ...(ended ? { homeScore: g.hspoint, awayScore: g.aspoint } : {}),
    };
  });
}

// 지난 시즌 코드 ('023' → '022')
const previous = (code: string) => String(Number(code) - 1).padStart(code.length, "0");

export function kovo(fetcher: Fetcher = fetch, now = () => new Date()): SourceAdapter {
  return {
    source: "kovo",
    async fetchMatches(gender: string) {
      const current = await kovoSeason(fetcher);
      // 새 시즌으로 넘어갔는데 일정이 아직 없으면 지난 시즌 일정을 받는다
      let games: KovoGame[] = [];
      for (const season of [current, previous(current)]) {
        const page = await kovoGet<{ content?: KovoGame[] }>(fetcher, `/stat/game-schedule?seasonCode=${season}&gender=${gender}&size=500`);
        if (!Array.isArray(page.content)) throw new SourceError("KOVO 응답 형식이 바뀌었습니다");
        games = page.content;
        if (games.length) break;
      }
      const result: FetchResult = parseKovo(games);
      // 시즌 전체를 받으므로 앞으로의 경기가 빠졌으면 출처가 지운 것이다 (시리즈가 일찍 끝나 사라진 '진출 시' 경기)
      const t = now().getTime();
      if (result.length) result.coverage = [{ from: new Date(t).toISOString(), to: new Date(t + 365 * 86_400_000).toISOString() }];
      return result;
    },
  };
}
