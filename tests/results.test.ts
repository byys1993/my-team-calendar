import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseEspnEvent, type EspnEvent } from "@/collector/sources/espn";
import { fdResult, parseFootballData } from "@/collector/sources/footballData";
import { parseKleague, type KleagueGame } from "@/collector/sources/kleague";
import { parseKboMonth } from "@/collector/sources/kbo";
import { parseLolEvent, type LolEvent } from "@/collector/sources/lolesports";
import { upsertMatches } from "@/collector/upsert";
import { resultFor } from "@/components/result";
import type { Db } from "@/lib/db";
import { getMatchesForTeams, type ScheduleMatch } from "@/lib/schedule";
import { espnMatch, setupDb } from "./helpers";

describe("소스별 경기 결과", () => {
  it("football-data: 끝난 경기만 점수", () => {
    const base = {
      utcDate: "2026-10-18T14:00:00Z",
      matchday: 8,
      stage: "REGULAR_SEASON",
      group: null,
      season: { startDate: "2026-08-15" },
      homeTeam: { id: 57, name: "Arsenal FC" },
      awayTeam: { id: 62, name: "Everton FC" },
      score: { fullTime: { home: 2, away: 1 } },
    };
    const [done, live] = parseFootballData({
      matches: [
        { ...base, id: 1, status: "FINISHED" },
        { ...base, id: 2, status: "IN_PLAY" },
      ],
    });
    expect(done).toMatchObject({ homeScore: 2, awayScore: 1 });
    expect(live.homeScore).toBeUndefined();
  });

  it("ESPN: 팀 일정 응답의 점수 객체와 scoreboard 의 문자열 점수", () => {
    const ev = (score: unknown, completed: boolean): EspnEvent =>
      ({
        id: "1",
        date: "2026-10-18T14:00Z",
        competitions: [
          {
            status: { type: { name: completed ? "STATUS_FULL_TIME" : "STATUS_SCHEDULED", completed } },
            competitors: [
              { homeAway: "home", team: { id: "359", displayName: "Arsenal" }, score },
              { homeAway: "away", team: { id: "368", displayName: "Everton" }, score: typeof score === "string" ? "0" : { value: 0, displayValue: "0" } },
            ],
          },
        ],
      }) as EspnEvent;
    expect(parseEspnEvent(ev({ value: 3, displayValue: "3" }, true))).toMatchObject({ homeScore: 3, awayScore: 0 });
    expect(parseEspnEvent(ev("3", true), "basketball/nba")).toMatchObject({ homeScore: 3, awayScore: 0 });
    expect(parseEspnEvent(ev("0", false))?.homeScore).toBeUndefined();
  });

  it("K리그·KBO·LoL", () => {
    const k = parseKleague([
      {
        year: 2026, leagueId: 1, meetSeq: 1, meetName: "하나은행 K리그1 2026", roundId: 31, gameId: 181,
        gameDate: "2026.10.09", gameTime: "14:00", homeTeam: "K10", homeTeamName: "대전", awayTeam: "K05",
        awayTeamName: "전북", endYn: "Y", homeGoal: 2, awayGoal: 1,
      } as KleagueGame,
    ]);
    expect(k[0]).toMatchObject({ homeScore: 2, awayScore: 1 });

    const row = (play: string) => ({
      row: [
        { Text: "09.01(화)", Class: "day" },
        { Text: "18:30", Class: "time" },
        { Text: play, Class: "play" },
        { Text: "", Class: "relay" },
        { Text: "", Class: null },
        { Text: "SPO-T", Class: null },
        { Text: "", Class: null },
        { Text: "잠실", Class: null },
        { Text: "-", Class: null },
      ],
    });
    const kbo = parseKboMonth(
      {
        rows: [
          row('<span>LG</span><em><span class="win">3</span><span>vs</span><span class="lose">1</span></em><span>두산</span>'),
          row('<span>KT</span><em><span class="same">4</span><span>vs</span><span class="same">4</span></em><span>한화</span>'),
          row("<span>롯데</span><em><span>vs</span></em><span>삼성</span>"),
        ],
      } as Parameters<typeof parseKboMonth>[0],
      2026,
      false,
    );
    // KBO 표기는 '원정 vs 홈'
    expect(kbo[0]).toMatchObject({ awayScore: 3, homeScore: 1, broadcast: "SPOTV" });
    expect(kbo[1]).toMatchObject({ awayScore: 4, homeScore: 4 });
    expect(kbo[2].homeScore).toBeUndefined();

    const lol: LolEvent = {
      startTime: "2026-10-18T08:00:00Z",
      state: "completed",
      type: "match",
      match: {
        id: "m1",
        teams: [
          { name: "T1", code: "T1", result: { outcome: "win", gameWins: 2 } },
          { name: "Gen.G", code: "GEN", result: { outcome: "loss", gameWins: 1 } },
        ],
      },
    };
    expect(parseLolEvent(lol)).toMatchObject({ homeScore: 2, awayScore: 1 });
  });
});

describe("결과 저장과 내 팀 기준 승무패", () => {
  let db: Db & { close(): Promise<void> };
  let eplId: number;
  beforeEach(async () => {
    ({ db, eplId } = (await setupDb()) as { db: Db & { close(): Promise<void> }; eplId: number });
  });
  afterEach(() => db.close());

  it("결과가 들어오면 저장하고, 결과 없이 다시 와도 지우지 않으며, 일정 변경 횟수는 올리지 않는다", async () => {
    await upsertMatches(db, eplId, "espn", [espnMatch()]);
    await upsertMatches(db, eplId, "espn", [espnMatch({ homeScore: 2, awayScore: 2 })]);
    await upsertMatches(db, eplId, "espn", [espnMatch()]);
    const [m] = await getMatchesForTeams(db, ["arsenal"], "ko");
    expect(m).toMatchObject({ homeScore: 2, awayScore: 2, sequence: 0 });
  });

  it("내 팀 기준으로 승·무·패를 고른다", () => {
    const m = { home: "arsenal", away: "everton", homeScore: 1, awayScore: 3 } as ScheduleMatch;
    expect(resultFor(m, "everton")).toEqual({ mine: 3, theirs: 1, outcome: "win" });
    expect(resultFor(m, "arsenal")).toEqual({ mine: 1, theirs: 3, outcome: "loss" });
    expect(resultFor({ ...m, awayScore: 1 }, "arsenal")?.outcome).toBe("draw");
    expect(resultFor({ ...m, homeScore: null }, "arsenal")).toBeNull();
    expect(resultFor(m, "chelsea")).toBeNull();
  });
});

describe("승부차기", () => {
  it("ESPN: 팀 일정 응답(score 안)과 scoreboard(competitor)의 승부차기 점수", () => {
    const ev = (home: object, away: object): EspnEvent =>
      ({
        id: "401921835",
        date: "2026-10-27T19:45Z",
        competitions: [
          {
            status: { type: { name: "STATUS_FINAL_PEN", completed: true } },
            notes: [{ headline: "Fleetwood Town win 5-3 on penalties" }],
            competitors: [
              { homeAway: "home", team: { id: "3891", displayName: "Fleetwood Town" }, ...home },
              { homeAway: "away", team: { id: "359", displayName: "Arsenal" }, ...away },
            ],
          },
        ],
      }) as EspnEvent;
    expect(
      parseEspnEvent(ev({ score: { value: 1, displayValue: "1", shootoutScore: 5 } }, { score: { value: 1, displayValue: "1", shootoutScore: 3 } })),
    ).toMatchObject({ homeScore: 1, awayScore: 1, homePen: 5, awayPen: 3 });
    expect(parseEspnEvent(ev({ score: "1", shootoutScore: 5 }, { score: "1", shootoutScore: 3 }))).toMatchObject({ homePen: 5, awayPen: 3 });
    expect(parseEspnEvent(ev({ score: "2" }, { score: "1" }))?.homePen).toBeUndefined();
  });

  it("football-data: 승부차기 골이 더해진 fullTime 을 정규+연장과 승부차기로 나눈다", () => {
    expect(fdResult({ fullTime: { home: 5, away: 4 }, regularTime: { home: 1, away: 1 }, extraTime: { home: 0, away: 0 }, penalties: { home: 4, away: 3 } })).toEqual({
      homeScore: 1, awayScore: 1, homePen: 4, awayPen: 3,
    });
    expect(fdResult({ fullTime: { home: 6, away: 5 }, penalties: { home: 4, away: 3 } })).toMatchObject({ homeScore: 2, awayScore: 2 });
    expect(fdResult({ fullTime: { home: 2, away: 1 } })).toEqual({ homeScore: 2, awayScore: 1 });
  });

  it("승패는 승부차기로, 점수는 정규·연장 그대로. 저장 후 라운드 자리의 승부차기 문구는 감춘다", async () => {
    const m = { home: "arsenal", away: "everton", homeScore: 1, awayScore: 1, homePen: 3, awayPen: 5 } as ScheduleMatch;
    expect(resultFor(m, "arsenal")).toEqual({ mine: 1, theirs: 1, outcome: "loss", pen: { mine: 3, theirs: 5 } });
    expect(resultFor(m, "everton")).toMatchObject({ outcome: "win", pen: { mine: 5, theirs: 3 } });

    const { db, eplId } = (await setupDb()) as { db: Db & { close(): Promise<void> }; eplId: number };
    try {
      await upsertMatches(db, eplId, "espn", [espnMatch({ roundLabel: "Everton win 5-3 on penalties", homeScore: 1, awayScore: 1, homePen: 3, awayPen: 5 })]);
      const [saved] = await getMatchesForTeams(db, ["arsenal"], "ko");
      expect(saved).toMatchObject({ homeScore: 1, awayScore: 1, homePen: 3, awayPen: 5, roundLabel: null });
    } finally {
      await db.close();
    }
  });
});
