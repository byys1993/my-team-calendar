import { describe, expect, it } from "vitest";
import { extraOf } from "@/collector/sources/espn";
import { kboExtra } from "@/collector/sources/kbo";
import { kblExtra } from "@/collector/sources/kbl";
import { parseMlb } from "@/collector/sources/mlb";
import { parseNhlGame } from "@/collector/sources/nhl";
import { extraLabel } from "@/components/result";
import { MESSAGES } from "@/i18n";

describe("연장·슛아웃", () => {
  it("ESPN: 'Final/OT'·'Final/2OT'·축구 연장(AET)", () => {
    expect(extraOf({ name: "STATUS_FINAL", detail: "Final/OT" })).toEqual({ extra: "ot" });
    expect(extraOf({ name: "STATUS_FINAL", detail: "Final/2OT" })).toEqual({ extra: "ot:2" });
    expect(extraOf({ name: "STATUS_FINAL_AET", detail: "AET" })).toEqual({ extra: "ot" });
    expect(extraOf({ name: "STATUS_FINAL", detail: "Final" })).toEqual({});
  });

  it("NHL: 연장(OT)·슛아웃(SO)", () => {
    const g = {
      id: 2026020188,
      season: 20262027,
      gameType: 2,
      startTimeUTC: "2026-10-27T23:00:00Z",
      gameScheduleState: "OK",
      gameState: "OFF",
      homeTeam: { id: 6, abbrev: "BOS", score: 3 },
      awayTeam: { id: 8, abbrev: "MTL", score: 2 },
    };
    expect(parseNhlGame({ ...g, gameOutcome: { lastPeriodType: "OT", otPeriods: 1 } })?.extra).toBe("ot");
    expect(parseNhlGame({ ...g, gameOutcome: { lastPeriodType: "SO" } })?.extra).toBe("so");
    expect(parseNhlGame({ ...g, gameOutcome: { lastPeriodType: "REG" } })?.extra).toBeUndefined();
  });

  it("MLB: 정규 이닝보다 길면 연장 n회", () => {
    const game = (inning: number) => ({
      gamePk: 849803,
      gameDate: "2026-10-27T00:00:00Z",
      officialDate: "2026-10-26",
      season: "2026",
      gameType: "W",
      status: { detailedState: "Final", abstractGameState: "Final" },
      teams: { home: { team: { id: 158, name: "Milwaukee Brewers" }, score: 4 }, away: { team: { id: 139, name: "Tampa Bay Rays" }, score: 3 } },
      scheduledInnings: 9,
      linescore: { currentInning: inning },
    });
    const [extra, regular] = parseMlb({ dates: [{ games: [game(12), { ...game(9), gamePk: 2 }] }] });
    expect(extra.extra).toBe("inn:12");
    expect(regular.extra).toBeUndefined();
  });

  it("KBO: 경기센터 이닝 수 / KBL: 연장 쿼터 점수", () => {
    expect(kboExtra({ G_ID: "20261010LGLT0", GAME_STATE_SC: "3", GAME_INN_NO: 10 })).toBe("inn:10");
    expect(kboExtra({ G_ID: "20261012LTOB0", GAME_STATE_SC: "3", GAME_INN_NO: 9 })).toBeNull();
    expect(kboExtra({ G_ID: "20261028HTSS0", GAME_STATE_SC: "2", GAME_INN_NO: 11 })).toBeNull(); // 진행 중
    expect(kblExtra({ teamrecords: { home: { scoreeq: [] } } })).toBeNull();
    expect(kblExtra({ teamrecords: { home: { scoreeq: [{ q: 1 }] } } })).toBe("ot");
    expect(kblExtra({ teamrecords: { home: { scoreeq: [{}, {}] } } })).toBe("ot:2");
    expect(kblExtra({})).toBeNull();
  });

  it("화면 표시 (한국어·영어)", () => {
    const ko = MESSAGES.ko.results;
    expect(extraLabel("ot", ko)).toBe("연장");
    expect(extraLabel("ot:2", ko)).toBe("2차 연장");
    expect(extraLabel("inn:12", ko)).toBe("연장 12회");
    expect(extraLabel("so", ko)).toBe("슛아웃");
    expect(extraLabel("ot:3", MESSAGES.en.results)).toBe("3OT");
    expect(extraLabel(null, ko)).toBeNull();
  });
});
