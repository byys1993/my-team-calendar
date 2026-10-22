import type { Fetcher, SourceAdapter, SourceMatch } from "../types";
import { normalizeBroadcast } from "./broadcast";

// K리그 공식 홈페이지(kleague.com)가 쓰는 일정 데이터 (공식 공개 API 아님).
// externalId 는 리그 번호('1' K리그1, '2' K리그2). 월 단위로만 응답해서 한 달씩 받는다.
// 월은 반드시 두 자리('03')로 보내야 한다. '3' 으로 보내면 빈 목록이 온다.
// 승강 플레이오프는 K리그1 쪽 응답에 함께 온다.
const URL = "https://www.kleague.com/getScheduleList.do";
const HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "X-Requested-With": "XMLHttpRequest",
  Referer: "https://www.kleague.com/schedule.do",
  // 언어를 안 정하면(Node fetch 는 '*') 영어 경기장 이름이 온다
  "Accept-Language": "ko-KR,ko;q=0.9",
};

export interface KleagueGame {
  year: number;
  leagueId: number;
  meetSeq: number; // 1 K리그1, 2 K리그2, 3 승강 PO
  meetName: string;
  roundId: number;
  gameId: number;
  gameDate: string; // 'YYYY.MM.DD'
  gameTime: string | null; // 'HH:MM' (KST)
  homeTeam: string; // 'K01'
  homeTeamName: string;
  awayTeam: string;
  awayTeamName: string;
  fieldNameFull?: string | null;
  fieldName?: string | null;
  codeName?: string | null; // '일반', '스플릿일반', '파이널A', '파이널B', 'Play Off'
  broadcastName?: string | null; // 'JTBC SPORTS//COUPANGPLAY'
}

// 라운드 표시 토큰: 정규 'N라운드', 파이널 라운드, K리그2 준PO·PO, 승강 PO N차전
export function kleagueRound(g: KleagueGame, firstPoRound: number): string {
  if (/승강/.test(g.meetName)) return `@series:kl_promo|@game:${g.roundId}`;
  if (g.codeName === "Play Off") return `@series:${g.roundId === firstPoRound ? "kl2_semi_po" : "kl2_po"}`;
  if (g.codeName === "파이널A") return `@stage:kl_final_a|@round:${g.roundId}`;
  if (g.codeName === "파이널B") return `@stage:kl_final_b|@round:${g.roundId}`;
  return `@round:${g.roundId}`;
}

export function parseKleague(games: KleagueGame[]): SourceMatch[] {
  const po = games.filter((g) => g.codeName === "Play Off" && !/승강/.test(g.meetName)).map((g) => g.roundId);
  const firstPoRound = po.length ? Math.min(...po) : -1;
  return games
    .filter((g) => g.homeTeam && g.awayTeam && /^\d{4}\.\d{2}\.\d{2}$/.test(g.gameDate))
    .map((g) => {
      const date = g.gameDate.replace(/\./g, "-");
      const time = g.gameTime && /^\d{2}:\d{2}$/.test(g.gameTime) ? g.gameTime : null;
      return {
        externalId: `${g.year}-${g.meetSeq}-${g.gameId}`,
        season: String(g.year),
        roundLabel: kleagueRound(g, firstPoRound),
        home: { externalId: g.homeTeam, name: g.homeTeamName },
        away: { externalId: g.awayTeam, name: g.awayTeamName },
        startAt: time ? new Date(`${date}T${time}:00+09:00`).toISOString() : null,
        dateOnly: time ? null : date,
        status: time ? "scheduled" : "time_tbd",
        venue: g.fieldNameFull || g.fieldName || null,
        broadcast: normalizeBroadcast(g.broadcastName),
      };
    });
}

// 한국 시간 기준 (연, 월) 목록
function monthsAround(now: Date, before: number, after: number): { y: number; m: number }[] {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const out: { y: number; m: number }[] = [];
  for (let i = -before; i <= after; i++) {
    const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + i, 1));
    out.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 });
  }
  return out;
}

export function kleague(fetcher: Fetcher = fetch, now = () => new Date()): SourceAdapter {
  async function month(league: string, y: number, m: number): Promise<KleagueGame[]> {
    const res = await fetcher(URL, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ leagueId: league, year: String(y), month: String(m).padStart(2, "0") }),
    });
    if (!res.ok) throw new Error(`K리그 응답 ${res.status}`);
    const body = (await res.json()) as { data?: { scheduleList?: KleagueGame[] } };
    const list = body.data?.scheduleList;
    if (!Array.isArray(list)) throw new Error("K리그 응답 형식이 바뀌었습니다");
    return list;
  }
  async function range(league: string, before: number, after: number): Promise<SourceMatch[]> {
    const games: KleagueGame[] = [];
    for (const { y, m } of monthsAround(now(), before, after)) games.push(...(await month(league, y, m)));
    return parseKleague(games);
  }
  return {
    source: "kleague",
    // 지난 10개월 ~ 앞으로 4개월 (시즌 전체, 해가 바뀌는 승강 PO·개막 포함)
    fetchMatches: (league) => range(league, 10, 4),
    // 경기 당일: 이번 달 앞뒤 한 달씩
    fetchRecent: (league) => range(league, 1, 1),
  };
}
