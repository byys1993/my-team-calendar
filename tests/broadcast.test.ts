import { describe, expect, it } from "vitest";
import { kboBroadcast, normalizeBroadcast } from "@/collector/sources/broadcast";
import { parseKleague, type KleagueGame } from "@/collector/sources/kleague";
import { isDawn } from "@/components/time";
import { mergeBroadcast, type ScheduleMatch } from "@/lib/schedule";

describe("중계 채널", () => {
  it("공식 데이터 표기를 읽기 쉬운 이름으로", () => {
    expect(normalizeBroadcast("JTBC SPORTS//COUPANGPLAY")).toBe("JTBC SPORTS, 쿠팡플레이");
    expect(normalizeBroadcast("tvN SPORTS")).toBe("tvN SPORTS");
    expect(normalizeBroadcast("")).toBeNull();
    expect(normalizeBroadcast(null)).toBeNull();
    expect(kboBroadcast("SPO-T")).toBe("SPOTV");
    expect(kboBroadcast("SS-T, KN-T")).toBe("SBS Sports, KBS N SPORTS");
    expect(kboBroadcast("XX-T")).toBe("XX"); // 모르는 약어는 '-T' 만 뗀다
  });

  it("경기별 채널 뒤에 대회 기본 플랫폼을 중복 없이 붙인다", () => {
    expect(mergeBroadcast("SPOTV", "TVING")).toBe("SPOTV, TVING");
    expect(mergeBroadcast("JTBC SPORTS, 쿠팡플레이", "쿠팡플레이")).toBe("JTBC SPORTS, 쿠팡플레이");
    expect(mergeBroadcast(null, "쿠팡플레이")).toBe("쿠팡플레이");
    expect(mergeBroadcast(null, null)).toBeNull();
  });

  it("K리그 일정의 중계 칸을 읽는다", () => {
    const g = {
      year: 2026,
      leagueId: 1,
      meetSeq: 1,
      meetName: "하나은행 K리그1 2026",
      roundId: 33,
      gameId: 198,
      gameDate: "2026.10.24",
      gameTime: "14:00",
      homeTeam: "K09",
      homeTeamName: "서울",
      awayTeam: "K21",
      awayTeamName: "강원",
      broadcastName: "ENA SPORTS//COUPANGPLAY",
    } as KleagueGame;
    expect(parseKleague([g])[0].broadcast).toBe("ENA SPORTS, 쿠팡플레이");
  });
});

describe("새벽 경기", () => {
  const m = (startAt: string, status: ScheduleMatch["status"] = "scheduled") => ({ startAt, status }) as ScheduleMatch;
  it("보는 시간대 기준 0시~5시 59분 시작이면 새벽", () => {
    expect(isDawn(m("2026-10-24T19:30:00Z"), "Asia/Seoul")).toBe(true); // 서울 04:30
    expect(isDawn(m("2026-10-24T21:00:00Z"), "Asia/Seoul")).toBe(false); // 서울 06:00
    expect(isDawn(m("2026-10-24T14:59:00Z"), "Asia/Seoul")).toBe(false); // 서울 23:59
    expect(isDawn(m("2026-10-24T15:00:00Z"), "Asia/Seoul")).toBe(true); // 서울 00:00
    // 같은 경기도 런던에서는 저녁
    expect(isDawn(m("2026-10-24T19:30:00Z"), "Europe/London")).toBe(false);
    // 시간 미정은 표시하지 않는다
    expect(isDawn(m("2026-10-24T19:30:00Z", "time_tbd"), "Asia/Seoul")).toBe(false);
  });
});
