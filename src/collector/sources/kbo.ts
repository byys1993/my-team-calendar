import type { Fetcher, MatchStatus, SourceAdapter, SourceMatch } from "../types";
import { kboBroadcast } from "./broadcast";
import { sleep, SourceError } from "./http";

// KBO 공식 사이트(koreabaseball.com) 일정 화면이 쓰는 데이터. 공식 API가 아니라 화면용 표 데이터라
// 셀 HTML 을 읽는다. 월 단위로 정규시즌과 포스트시즌을 따로 받는다. 시각은 한국 시간이다.
const URL = "https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleList";
const REGULAR = "0,9,6";
const POSTSEASON = "3,4,5,7"; // 준PO, 와일드카드, PO, 한국시리즈
const SEASON_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11];
const POSTSEASON_MONTHS = [9, 10, 11];

// 화면에 나오는 팀 이름 → KBO 팀 코드 (경기 ID에 쓰이는 코드)
const TEAM_CODE: Record<string, string> = {
  KIA: "HT",
  두산: "OB",
  LG: "LG",
  삼성: "SS",
  키움: "WO",
  SSG: "SK",
  KT: "KT",
  NC: "NC",
  롯데: "LT",
  한화: "HH",
};

interface Cell {
  Text: string;
  Class: string | null;
}
interface KboResponse {
  rows: { row: Cell[] }[];
}

const strip = (html: string) => html.replace(/<[^>]*>/g, "").trim();

interface KboRow {
  date: string;
  awayName: string;
  homeName: string;
  awayCode: string;
  homeCode: string;
  cells: Cell[];
}

export type KboGame = SourceMatch & { winner: string | null };

// 비고의 시리즈 표기('WC 1차전', '준PO 2차전', 'PO 3차전', 'KS 1차전') → 언어 중립 토큰
const KBO_SERIES: Record<string, string> = { WC: "kbo_wc", 준PO: "kbo_semi", PO: "kbo_po", KS: "kbo_ks", 한국시리즈: "kbo_ks" };

export function kboRound(note: string): string {
  const m = note.match(/^(.+?)\s*(\d+)차전$/);
  const key = m && KBO_SERIES[m[1].trim()];
  if (m && key) return `@series:${key}|@game:${m[2]}`;
  return note && note !== "-" ? `@t:${note}` : "@postseason";
}

// 포스트시즌 'N차전' 중 시리즈가 먼저 끝나면 열리지 않는 경기를 '진출 시'로 바꾼다.
// KBO 는 최대 경기 수만큼 미리 일정을 올려 두고, 시리즈가 끝나면 남은 경기를 지운다.
// N차전은 '지금까지 치른 경기 수 + 앞선 팀이 이기려면 더 필요한 승수' 안이면 반드시 열린다.
export function markConditional(games: KboGame[]): KboGame[] {
  const series = new Map<string, { no: number; g: KboGame }[]>();
  for (const g of games) {
    const m = g.roundLabel?.match(/^@series:([^|]+)\|@game:(\d+)$/);
    if (!m || g.status === "postponed") continue;
    const key = `${g.season}:${m[1]}`;
    series.set(key, [...(series.get(key) ?? []), { no: Number(m[2]), g }]);
  }
  for (const list of series.values()) {
    const maxGames = Math.max(...list.map((x) => x.no));
    const needed = Math.ceil(maxGames / 2);
    const wins = new Map<string, number>();
    let played = 0;
    for (const { g } of list) {
      if (!g.winner) continue;
      played++;
      wins.set(g.winner, (wins.get(g.winner) ?? 0) + 1);
    }
    const leader = Math.max(0, ...wins.values());
    const certainUpTo = played + (needed - leader);
    for (const { no, g } of list) {
      if (!g.winner && no > certainUpTo && g.status !== "cancelled") g.status = "conditional";
    }
  }
  return games;
}

// 한 달 치 표를 경기 목록으로 바꾼다. 날짜 칸은 그날 첫 줄에만 있어서 앞 줄 날짜를 이어 쓴다.
export function parseKboMonth(json: KboResponse, year: number, postseason: boolean): KboGame[] {
  const games: KboRow[] = [];
  let date: string | null = null;
  for (const { row } of json.rows) {
    const day = row.find((c) => c.Class === "day");
    if (day) {
      const m = strip(day.Text).match(/^(\d{2})\.(\d{2})/);
      if (m) date = `${year}-${m[1]}-${m[2]}`;
    }
    const play = row.find((c) => c.Class === "play");
    if (!date || !play) continue; // '이동일' 같은 경기 없는 줄
    const names = [...play.Text.matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1].trim()).filter((n) => n !== "vs");
    if (names.length < 2) continue;
    // KBO 표기는 '원정 vs 홈'
    const [awayName, homeName] = [names[0], names[names.length - 1]];
    const awayCode = TEAM_CODE[awayName];
    const homeCode = TEAM_CODE[homeName];
    if (!awayCode || !homeCode) throw new SourceError(`알 수 없는 KBO 팀: ${awayName} / ${homeName}`);
    games.push({ date, awayName, homeName, awayCode, homeCode, cells: row });
  }

  // 같은 날 같은 대진이 두 번이면 더블헤더: 공식 ID 끝자리가 1, 2 이고 평소에는 0
  const pairKey = (g: KboRow) => `${g.date.replace(/-/g, "")}${g.awayCode}${g.homeCode}`;
  const perDay = new Map<string, number>();
  for (const g of games) perDay.set(pairKey(g), (perDay.get(pairKey(g)) ?? 0) + 1);
  const seen = new Map<string, number>();

  const out: KboGame[] = [];
  for (const g of games) {
    const { date, awayName, homeName, awayCode, homeCode, cells: row } = g;
    const timeText = strip(row.find((c) => c.Class === "time")?.Text ?? "");
    const time = /^\d{1,2}:\d{2}$/.test(timeText) ? timeText.padStart(5, "0") : null;
    const cells = row.map((c) => strip(c.Text));
    const note = cells[cells.length - 1];
    const venue = cells[cells.length - 2] || null;
    // 칸 순서: … TV, 라디오, 구장, 비고
    const broadcast = kboBroadcast(cells[cells.length - 4]);

    // 공식 경기 ID (예: 20261025HTSS0). 링크가 없는 취소 경기는 같은 규칙으로 만든다.
    const linked = row.map((c) => c.Text.match(/gameId=(\d{8}[A-Z]{4}\d)/)?.[1]).find(Boolean);
    const key = pairKey(g);
    const nth = (seen.get(key) ?? 0) + 1;
    seen.set(key, nth);
    const gameId = linked ?? `${key}${perDay.get(key)! > 1 ? nth : 0}`;

    let status: MatchStatus = time ? "scheduled" : "time_tbd";
    if (/취소|순연|연기|노게임/.test(note)) status = "postponed";
    // 끝난 경기는 점수 칸에 win/lose 표시가 붙는다
    const playText = row.find((c) => c.Class === "play")!.Text;
    const won = playText.match(/<span class="win">/) ? (playText.indexOf('class="win"') < playText.indexOf("vs") ? awayCode : homeCode) : null;
    out.push({
      winner: won,
      externalId: gameId,
      season: String(year),
      roundLabel: postseason ? (status !== "postponed" ? kboRound(note) : "@postseason") : null,
      home: { externalId: homeCode, name: homeName },
      away: { externalId: awayCode, name: awayName },
      startAt: time ? new Date(`${date}T${time}:00+09:00`).toISOString() : null,
      dateOnly: time ? null : date,
      status,
      venue,
      broadcast,
    });
  }
  return out;
}

export function kbo(fetcher: Fetcher = fetch, opts: { delayMs?: number; now?: () => Date } = {}): SourceAdapter {
  const delayMs = opts.delayMs ?? 300;
  const now = opts.now ?? (() => new Date());

  async function month(leagueId: string, year: number, m: number, series: string): Promise<KboGame[]> {
    const r = await fetcher(URL, {
      method: "POST",
      headers: {
        "User-Agent": "my-team-calendar (non-commercial fan project)",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Referer: "https://www.koreabaseball.com/Schedule/Schedule.aspx",
      },
      body: new URLSearchParams({
        leId: leagueId,
        srIdList: series,
        seasonId: String(year),
        gameMonth: String(m).padStart(2, "0"),
        teamId: "",
      }).toString(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new SourceError(`${r.status} ${r.statusText} — KBO ${year}-${m}`);
    return parseKboMonth((await r.json()) as KboResponse, year, series === POSTSEASON);
  }

  // 수집 서버(GitHub Actions)는 UTC 라서 한국 시간 기준 연·월을 따로 구한다
  const kstNow = () => new Date(now().getTime() + 9 * 3600_000);

  async function collect(
    leagueId: string,
    regularMonths: number[],
    postseasonMonths: number[],
  ): Promise<SourceMatch[]> {
    const year = kstNow().getUTCFullYear();
    const byId = new Map<string, KboGame>();
    for (const [series, months] of [[REGULAR, regularMonths], [POSTSEASON, postseasonMonths]] as const) {
      for (const m of months) {
        for (const g of await month(leagueId, year, m, series)) byId.set(g.externalId, g);
        if (delayMs) await sleep(delayMs);
      }
    }
    // 시리즈 전체를 봐야 하므로 여러 달을 합친 뒤 판단하고, 내부용 winner 는 떼어 낸다
    return markConditional([...byId.values()]).map((g) => {
      const m: SourceMatch & { winner?: string | null } = { ...g };
      delete m.winner;
      return m;
    });
  }

  return {
    source: "kbo",
    fetchMatches: (leagueId) => collect(leagueId, SEASON_MONTHS, POSTSEASON_MONTHS),
    // 경기 당일: 정규시즌은 이번 달만(월말이면 다음 달도), 포스트시즌은 시리즈가 달을 넘기므로 가을 전체
    fetchRecent: (leagueId) => {
      const d = kstNow();
      const m = d.getUTCMonth() + 1;
      const regular = d.getUTCDate() >= 25 && m < 12 ? [m, m + 1] : [m];
      return collect(leagueId, regular, POSTSEASON_MONTHS.includes(m) ? POSTSEASON_MONTHS : []);
    },
  };
}
