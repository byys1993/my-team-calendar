import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dueMode, syncCompetition } from "@/collector/run";
import { footballData, parseFootballData } from "@/collector/sources/footballData";
import { parseEspnEvent } from "@/collector/sources/espn";
import type { SourceAdapter } from "@/collector/types";
import type { Db } from "@/lib/db";
import { espnMatch, setupDb } from "./helpers";

let db: Db & { close(): Promise<void> };
let eplId: number;

beforeEach(async () => {
  ({ db, eplId } = await setupDb());
});
afterEach(async () => {
  await db.close();
});

const espnOk: SourceAdapter = { source: "espn", fetchMatches: async () => [espnMatch()] };

describe("syncCompetition", () => {
  it("주 소스가 실패하면 대체 소스로 넘어가고 실패를 기록한다", async () => {
    const adapters = { "football-data": footballData(undefined), espn: espnOk };
    const r = await syncCompetition(db, { id: eplId, slug: "epl", postseason: false }, adapters);
    expect(r).toMatchObject({ ok: true, source: "espn", fallback: true, inserted: 1 });

    const runs = await db.query<{ source: string; ok: boolean; is_fallback: boolean; error: string | null }>(
      "select source, ok, is_fallback, error from sync_run order by id",
    );
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ source: "football-data", ok: false, is_fallback: false });
    expect(runs[0].error).toContain("FOOTBALL_DATA_API_KEY");
    expect(runs[1]).toMatchObject({ source: "espn", ok: true, is_fallback: true });

    const [st] = await db.query<{ last_source: string; last_success_at: Date | null }>(
      "select last_source, last_success_at from competition_status",
    );
    expect(st.last_source).toBe("espn");
    expect(st.last_success_at).not.toBeNull();
  });

  it("모든 소스가 실패하면 마지막 성공 시각을 바꾸지 않는다", async () => {
    const broken: SourceAdapter = {
      source: "espn",
      fetchMatches: async () => {
        throw new Error("503");
      },
    };
    const r = await syncCompetition(db, { id: eplId, slug: "epl", postseason: false }, {
      "football-data": footballData(undefined),
      espn: broken,
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(2);
    const [st] = await db.query<{ last_success_at: Date | null }>("select last_success_at from competition_status");
    expect(st.last_success_at).toBeNull();
  });
});

describe("dueMode", () => {
  const comp = () => ({ id: eplId, slug: "epl", postseason: false });

  it("전체 수집은 12시간 주기, 경기 당일에는 매시간 최근 일정만", async () => {
    const now = new Date("2026-10-20T12:00:00Z");
    expect(await dueMode(db, comp(), now)).toBe("full");
    const tenAm = new Date("2026-10-20T10:00:00Z").toISOString();
    await db.query(
      "insert into competition_status (competition_id, last_attempt_at, last_full_at) values ($1, $2, $2)",
      [eplId, tenAm],
    );
    expect(await dueMode(db, comp(), now)).toBeNull(); // 2시간 경과, 경기 없음
    expect(await dueMode(db, comp(), new Date("2026-10-20T22:00:00Z"))).toBe("full"); // 12시간 경과

    await db.query(
      "insert into match (competition_id, season, start_at) values ($1, '2026', '2026-10-20T19:00:00Z')",
      [eplId],
    );
    expect(await dueMode(db, comp(), now)).toBe("recent"); // 오늘 경기가 있으니 매시간
    expect(await dueMode(db, comp(), new Date("2026-10-20T10:30:00Z"))).toBeNull(); // 직전 시도 30분 전
  });

  it("최근 수집은 fetchRecent 를 쓰고 전체 수집 시각은 바꾸지 않는다", async () => {
    let recentCalls = 0;
    const adapter: SourceAdapter = {
      source: "football-data",
      fetchMatches: async () => [],
      fetchRecent: async () => {
        recentCalls++;
        return [];
      },
    };
    const r = await syncCompetition(db, comp(), { "football-data": adapter }, "recent");
    expect(r.ok).toBe(true);
    expect(recentCalls).toBe(1);
    const [st] = await db.query<{ last_full_at: Date | null }>("select last_full_at from competition_status");
    expect(st.last_full_at).toBeNull();
  });
});

describe("소스 파서", () => {
  it("football-data: TIMED는 확정, SCHEDULED는 시간 미정, 상대 미정은 대진 대기", () => {
    const base = {
      utcDate: "2026-10-24T14:00:00Z",
      matchday: 9,
      stage: "REGULAR_SEASON",
      group: null,
      season: { startDate: "2026-08-21" },
      homeTeam: { id: 57, name: "Arsenal FC", shortName: "Arsenal" },
      awayTeam: { id: 62, name: "Everton FC", shortName: "Everton" },
    };
    const [a, b, c, d] = parseFootballData({
      matches: [
        { ...base, id: 1, status: "TIMED" },
        { ...base, id: 2, status: "SCHEDULED" },
        { ...base, id: 3, status: "TIMED", stage: "FINAL", awayTeam: { id: null, name: null } },
        { ...base, id: 4, status: "TIMED", stage: "LEAGUE_STAGE", matchday: 3 },
      ],
    });
    expect(a).toMatchObject({ status: "scheduled", season: "2026", roundLabel: "9라운드" });
    expect(b.status).toBe("time_tbd");
    expect(c).toMatchObject({ status: "draw_pending", away: null, roundLabel: "결승" });
    expect(d.roundLabel).toBe("리그 페이즈 3차전");
  });

  it("ESPN: 실제 응답 구조를 변환한다", () => {
    const m = parseEspnEvent({
      id: "401878768",
      date: "2026-10-24T14:00Z",
      timeValid: false,
      season: { year: 2026 },
      competitions: [
        {
          neutralSite: false,
          venue: { fullName: "Emirates Stadium" },
          status: { type: { name: "STATUS_SCHEDULED" } },
          competitors: [
            { homeAway: "home", team: { id: "359", displayName: "Arsenal" } },
            { homeAway: "away", team: { id: "368", displayName: "Everton" } },
          ],
        },
      ],
    });
    expect(m).toMatchObject({
      externalId: "401878768",
      startAt: "2026-10-24T14:00:00.000Z",
      status: "time_tbd",
      home: { externalId: "359" },
      away: { externalId: "368" },
      venue: "Emirates Stadium",
    });
  });
});
