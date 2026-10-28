import { describe, expect, it } from "vitest";
import { offSeasonNotice } from "@/components/offseasonNotice";
import type { ScheduleMatch } from "@/lib/schedule";

const match = (competition: string, startAt: string, roundLabel: string | null): ScheduleMatch => ({
  id: "x",
  competition,
  sport: "x",
  roundLabel,
  title: null,
  home: "a",
  away: "b",
  homeLabel: "A",
  awayLabel: "B",
  startAt,
  dateOnly: null,
  status: "scheduled",
  venue: null,
  isNeutral: false,
  podium: null,
  homeScore: 1,
  awayScore: 0,
  broadcast: null,
  sequence: 0,
  updatedAt: startAt,
});
const none = () => false;

describe("예정 경기가 없는 팀 카드 안내", () => {
  it("마지막 경기를 치른 대회에 남은 경기가 있으면 진행 중 (월즈)", () => {
    const n = offSeasonNotice({
      last: match("worlds", "2026-10-28T20:00:00Z", "@lol:swiss|@bo:3"),
      competition: "lck",
      competitionType: "league",
      isOngoing: (c) => c === "worlds",
      now: new Date("2026-10-29T03:00:00Z"),
    });
    expect(n).toEqual({ kind: "ongoing", competition: "worlds" });
  });

  it("국가대표는 시즌 종료라 하지 않는다", () => {
    const base = { competition: "korea-national", competitionType: "intl", isOngoing: none, now: new Date("2026-10-29T00:00:00Z") };
    expect(offSeasonNotice({ ...base, last: match("korea-national", "2026-10-14T11:00:00Z", null) }).kind).toBe("national");
    expect(offSeasonNotice({ ...base, last: undefined }).kind).toBe("national");
  });

  it("포스트시즌 경기를 치른 지 7일 안이면 다음 일정 대기 중, 그 뒤로는 시즌 종료", () => {
    const last = match("nba", "2026-05-20T01:00:00Z", "@postseason");
    const base = { last, competition: "nba", competitionType: "league", isOngoing: none };
    expect(offSeasonNotice({ ...base, now: new Date("2026-05-22T00:00:00Z") }).kind).toBe("postseason");
    expect(offSeasonNotice({ ...base, now: new Date("2026-06-05T00:00:00Z") }).kind).toBe("seasonOver");
    // KBO 한국시리즈·NHL 플레이오프 토큰도 포스트시즌
    const ks = { ...base, now: new Date("2026-10-30T00:00:00Z"), competition: "kbo" };
    expect(offSeasonNotice({ ...ks, last: match("kbo", "2026-10-28T09:30:00Z", "@series:kbo_ks|@game:3") }).kind).toBe("postseason");
    expect(offSeasonNotice({ ...ks, last: match("nhl", "2026-10-28T09:30:00Z", "@playoffs:2|@game:5") }).kind).toBe("postseason");
    // 정규 시즌 마지막 경기 직후는 그냥 시즌 종료
    expect(offSeasonNotice({ ...ks, last: match("kbo", "2026-10-28T09:30:00Z", null) }).kind).toBe("seasonOver");
  });

  it("LCK 일정이 끝난 뒤 국제 대회가 이어지는 달은 '리그 일정 종료'", () => {
    const last = match("lck", "2026-09-20T08:00:00Z", "@lol:playoffs|@bo:5");
    const base = { last, competition: "lck", competitionType: "league", isOngoing: none };
    expect(offSeasonNotice({ ...base, now: new Date("2026-09-30T00:00:00Z") }).kind).toBe("followUp");
    // 결승 직후(7일 안)도 국제 대회 안내
    expect(offSeasonNotice({ ...base, now: new Date("2026-09-22T00:00:00Z") }).kind).toBe("followUp");
    expect(offSeasonNotice({ ...base, now: new Date("2026-12-10T00:00:00Z") }).kind).toBe("seasonOver");
    // 다른 리그는 같은 달이라도 시즌 종료
    expect(
      offSeasonNotice({
        ...base,
        last: match("epl", "2026-05-24T15:00:00Z", "@md:38"),
        competition: "epl",
        now: new Date("2026-06-10T00:00:00Z"),
      }).kind,
    ).toBe("seasonOver");
  });

  it("최근 경기도 없으면 '예정된 경기 없음'", () => {
    expect(offSeasonNotice({ last: undefined, competition: "kbo", competitionType: "league", isOngoing: none, now: new Date() }).kind).toBe(
      "none",
    );
  });
});
