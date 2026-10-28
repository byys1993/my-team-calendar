import type { Fetcher, MatchStatus, SourceAdapter, SourceMatch, SourceTeam } from "../types";
import { request, sleep, SourceError } from "./http";

// https://docs.football-data.org/general/v4/match.html
interface FdTeam {
  id: number | null;
  name: string | null;
  shortName?: string | null;
}
interface FdMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday: number | null;
  stage: string;
  group: string | null;
  venue?: string | null;
  season: { startDate: string };
  homeTeam: FdTeam;
  awayTeam: FdTeam;
  score?: { fullTime?: FdScore; regularTime?: FdScore; extraTime?: FdScore; penalties?: FdScore };
}

type FdScore = { home: number | null; away: number | null };

// 끝난 경기 결과. 승부차기 경기는 fullTime 에 승부차기 골까지 더해져 오므로 정규+연장 점수와 승부차기 점수로 나눈다
export function fdResult(score: FdMatch["score"]): Pick<SourceMatch, "homeScore" | "awayScore" | "homePen" | "awayPen"> {
  const ft = score?.fullTime;
  const pen = score?.penalties;
  if (pen?.home == null || pen?.away == null || ft?.home == null || ft?.away == null) {
    return { homeScore: ft?.home ?? null, awayScore: ft?.away ?? null };
  }
  const rt = score?.regularTime;
  const et = score?.extraTime;
  const [home, away] =
    rt?.home != null && rt?.away != null
      ? [rt.home + (et?.home ?? 0), rt.away + (et?.away ?? 0)]
      : [ft.home - pen.home, ft.away - pen.away];
  return { homeScore: home, awayScore: away, homePen: pen.home, awayPen: pen.away };
}

// SCHEDULED = 날짜만 확정, TIMED = 시각까지 확정
const STATUS: Record<string, MatchStatus> = {
  SCHEDULED: "time_tbd",
  TIMED: "scheduled",
  POSTPONED: "postponed",
  SUSPENDED: "postponed",
  CANCELLED: "cancelled",
};

// 라운드는 언어 중립 토큰으로 저장한다 (src/i18n/format.ts 참고)
const STAGE_KEY: Record<string, string> = {
  LEAGUE_STAGE: "league",
  GROUP_STAGE: "group",
  PLAYOFFS: "playoffs",
  LAST_32: "last32",
  LAST_16: "last16",
  QUARTER_FINALS: "qf",
  SEMI_FINALS: "sf",
  THIRD_PLACE: "third",
  FINAL: "final",
};

function team(t: FdTeam): SourceTeam | null {
  if (t.id == null || !t.name) return null;
  return { externalId: String(t.id), name: t.name, shortName: t.shortName ?? undefined };
}

export function parseFootballData(json: { matches: FdMatch[] }): SourceMatch[] {
  return json.matches.map((m) => {
    const home = team(m.homeTeam);
    const away = team(m.awayTeam);
    const stage = STAGE_KEY[m.stage] ? `@stage:${STAGE_KEY[m.stage]}` : `@t:${m.stage}`;
    const roundLabel =
      m.stage === "REGULAR_SEASON"
        ? m.matchday
          ? `@md:${m.matchday}`
          : null
        : (m.stage === "LEAGUE_STAGE" || m.stage === "GROUP_STAGE") && m.matchday
          ? `${stage}|@md:${m.matchday}`
          : stage;
    let status = STATUS[m.status] ?? "scheduled";
    if ((!home || !away) && status !== "cancelled") status = "draw_pending";
    return {
      externalId: String(m.id),
      season: m.season.startDate.slice(0, 4),
      roundLabel,
      home,
      away,
      homePlaceholder: home ? null : "@tbd",
      awayPlaceholder: away ? null : "@tbd",
      startAt: m.utcDate,
      status,
      venue: m.venue ?? null,
      // 끝난 경기만 결과를 넣는다 (진행 중 점수는 넣지 않음)
      ...(m.status === "FINISHED" || m.status === "AWARDED"
        ? fdResult(m.score)
        : {}),
    };
  });
}

// football-data는 응답 헤더로 남은 요청 수(X-Requests-Available-Minute)와
// 카운터 초기화까지 남은 초(X-RequestCounter-Reset)를 알려준다. 소진되면 초기화까지 기다린다.
export class FdThrottle {
  private waitUntil = 0;

  constructor(
    private sleepFn: (ms: number) => Promise<unknown> = sleep,
    private now: () => number = Date.now,
  ) {}

  async getJson<T>(fetcher: Fetcher, url: string, apiKey: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.waitUntil - this.now();
      if (wait > 0) await this.sleepFn(wait);
      const res = await request(fetcher, url, { "X-Auth-Token": apiKey });
      const resetMs = (Number(res.headers.get("x-requestcounter-reset")) || 60) * 1000;
      const available = res.headers.get("x-requests-available-minute");
      if (available !== null && Number(available) <= 0) this.waitUntil = this.now() + resetMs;
      // 제한에 걸리면 초기화 후 한 번만 다시 시도
      if (res.status === 429 && attempt === 0) {
        this.waitUntil = this.now() + resetMs;
        continue;
      }
      if (!res.ok) throw new SourceError(`${res.status} ${res.statusText} — ${url}`);
      return (await res.json()) as T;
    }
  }
}

export function footballData(
  apiKey: string | undefined,
  fetcher: Fetcher = fetch,
  throttle = new FdThrottle(),
): SourceAdapter {
  return {
    source: "football-data",
    async fetchMatches(code) {
      if (!apiKey) throw new SourceError("FOOTBALL_DATA_API_KEY 가 설정되지 않았습니다.");
      // 현재 시즌 전체를 한 번에 받는다 (요청 1회)
      const json = await throttle.getJson<{ matches: FdMatch[] }>(
        fetcher,
        `https://api.football-data.org/v4/competitions/${encodeURIComponent(code)}/matches`,
        apiKey,
      );
      return parseFootballData(json);
    },
  };
}
