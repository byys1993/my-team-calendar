import type { Coverage, FetchResult, Fetcher, MatchStatus, SourceAdapter, SourceMatch } from "../types";
import { kboBroadcast } from "./broadcast";
import { sleep, SourceError } from "./http";

// KBO 공식 사이트(koreabaseball.com) 일정 화면이 쓰는 데이터. 공식 API가 아니라 화면용 표 데이터라
// 셀 HTML 을 읽는다. 월 단위로 정규시즌과 포스트시즌을 따로 받는다. 시각은 한국 시간이다.
const URL = "https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleList";
const REGULAR = "0,9,6";
const POSTSEASON = "3,4,5,7"; // 준PO, 와일드카드, PO, 한국시리즈
// 경기센터의 날짜별 경기 목록 (몇 회까지 했는지 GAME_INN_NO 가 있다)
const GAME_LIST_URL = "https://www.koreabaseball.com/ws/Main.asmx/GetKboGameList";
interface KboGameList {
  game?: { G_ID: string; GAME_STATE_SC: string; GAME_INN_NO: number | null; CANCEL_SC_ID?: string }[];
}

// 끝난 경기(GAME_STATE_SC 3)가 9회를 넘겼으면 연장 n회
export function kboExtra(x: NonNullable<KboGameList["game"]>[number]): string | null {
  return x.GAME_STATE_SC === "3" && (x.GAME_INN_NO ?? 0) > 9 ? `inn:${x.GAME_INN_NO}` : null;
}

const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);

const SEASON_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11];
const POSTSEASON_MONTHS = [9, 10, 11];

// 화면에 나오는 팀 이름 → KBO 팀 코드 (경기 ID에 쓰이는 코드)
export const TEAM_CODE: Record<string, string> = {
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

// 포스트시즌 N차전은 시리즈마다 하나뿐이다. 순연된 옛 날짜 줄이 비고 그대로 함께 오면
// (점수가 있는 줄, 없으면 가장 늦은 날짜 줄만 남기고) 나머지는 연기로 바꾼다.
export function markMovedGames(games: KboGame[]): KboGame[] {
  const slots = new Map<string, KboGame[]>();
  for (const g of games) {
    if (!g.roundLabel?.includes("@game:") || g.status === "postponed") continue;
    const key = `${g.season}:${g.roundLabel}`;
    slots.set(key, [...(slots.get(key) ?? []), g]);
  }
  const at = (g: KboGame) => g.startAt ?? `${g.dateOnly}T12:00:00Z`;
  for (const list of slots.values()) {
    if (list.length < 2) continue;
    const keep = list.find((g) => g.homeScore != null) ?? list.reduce((a, b) => (at(b) > at(a) ? b : a));
    for (const g of list) {
      if (g === keep || g.homeScore != null) continue;
      g.status = "postponed";
      g.roundLabel = "@postseason";
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
    // 채널이 둘 이상이면 <br> 로 나뉘어 오므로 태그를 지우기 전에 쉼표로 바꾼다 ('KN-T<br>SPO-T')
    const broadcast = kboBroadcast(strip((row[row.length - 4]?.Text ?? "").replace(/<br\s*\/?>/gi, ",")));

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
    // 점수 칸: 원정 점수, 홈 점수 순 (무승부는 class="same")
    const scores = [...playText.matchAll(/<span class="(?:win|lose|same)">(\d+)<\/span>/g)].map((x) => Number(x[1]));
    const final = scores.length === 2 && status !== "postponed" ? { awayScore: scores[0], homeScore: scores[1] } : {};
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
      ...final,
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
    extraDays: number,
  ): Promise<FetchResult> {
    const year = kstNow().getUTCFullYear();
    const byId = new Map<string, KboGame>();
    const nonEmpty = new Set<number>();
    for (const [series, months] of [[REGULAR, regularMonths], [POSTSEASON, postseasonMonths]] as const) {
      for (const m of months) {
        const games = await month(leagueId, year, m, series);
        if (games.length) nonEmpty.add(m);
        for (const g of games) byId.set(g.externalId, g);
        if (delayMs) await sleep(delayMs);
      }
    }
    await addExtraInnings(leagueId, [...byId.values()], extraDays);
    // 시리즈 전체를 봐야 하므로 여러 달을 합친 뒤 판단하고, 내부용 winner 는 떼어 낸다
    const out: FetchResult = markConditional(markMovedGames([...byId.values()])).map((g) => {
      const m: SourceMatch & { winner?: string | null } = { ...g };
      delete m.winner;
      return m;
    });
    // 빠짐없이 받은 달: 정규시즌과 (가을이면) 포스트시즌을 모두 받았고 응답이 비지 않은 달.
    // 응답이 빈 달은 일시적인 이상일 수 있어 정리하지 않는다.
    const kst = (y: number, m: number) => new Date(`${y + Math.floor((m - 1) / 12)}-${String(((m - 1) % 12) + 1).padStart(2, "0")}-01T00:00:00+09:00`).toISOString();
    out.coverage = regularMonths
      .filter((m) => nonEmpty.has(m) && (!POSTSEASON_MONTHS.includes(m) || postseasonMonths.includes(m)))
      .map((m): Coverage => ({ from: kst(year, m), to: kst(year, m + 1) }));
    return out;
  }

  // 연장전: 일정 표에는 이닝 정보가 없어서, 최근 며칠 끝난 경기만 날짜별 경기센터 목록(GAME_INN_NO)으로 확인한다.
  // 한 번 저장된 연장 표시는 지워지지 않으므로 지난 경기를 매번 다시 볼 필요는 없다. 실패해도 일정 수집은 그대로 둔다.
  async function addExtraInnings(leagueId: string, games: KboGame[], days: number) {
    const since = new Date(now().getTime() - days * 86_400_000).toISOString();
    const dates = new Set(
      games.filter((g) => g.homeScore != null && (g.startAt ?? g.dateOnly ?? "") >= since).map((g) => (g.startAt ? kstDate(g.startAt) : g.dateOnly!)),
    );
    const byId = new Map(games.map((g) => [g.externalId, g]));
    for (const date of dates) {
      try {
        const r = await fetcher(GAME_LIST_URL, {
          method: "POST",
          headers: {
            "User-Agent": "my-team-calendar (non-commercial fan project)",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Referer: "https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx",
          },
          body: new URLSearchParams({ leId: leagueId, srId: "0,1,3,4,5,6,7,8,9", date: date.replace(/-/g, "") }).toString(),
          signal: AbortSignal.timeout(30_000),
        });
        if (!r.ok) continue;
        for (const x of ((await r.json()) as KboGameList).game ?? []) {
          const extra = kboExtra(x);
          const g = byId.get(x.G_ID);
          if (g && extra) g.extra = extra;
        }
      } catch {
        // 연장 표시는 부가 정보라 다음 수집 때 다시 시도한다
      }
      if (delayMs) await sleep(delayMs);
    }
  }

  return {
    source: "kbo",
    datedIds: true,
    // 연장 확인: 하루 두 번 전체 수집 때는 최근 14일, 경기 당일 매시간 수집 때는 최근 2일
    fetchMatches: (leagueId) => collect(leagueId, SEASON_MONTHS, POSTSEASON_MONTHS, 14),
    // 경기 당일: 정규시즌은 이번 달만(월말이면 다음 달도), 포스트시즌은 시리즈가 달을 넘기므로 가을 전체
    fetchRecent: (leagueId) => {
      const d = kstNow();
      const m = d.getUTCMonth() + 1;
      const regular = d.getUTCDate() >= 25 && m < 12 ? [m, m + 1] : [m];
      return collect(leagueId, regular, POSTSEASON_MONTHS.includes(m) ? POSTSEASON_MONTHS : [], 2);
    },
  };
}
