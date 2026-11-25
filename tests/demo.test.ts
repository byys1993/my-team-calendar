import { describe, expect, it } from "vitest";
import { demoCandidates, pickDemo } from "@/components/demo";
import type { ScheduleMatch } from "@/lib/schedule";

const NOW = Date.parse("2026-11-25T00:00:00Z");
const DAY = 86_400_000;

function match(home: string, away: string, at: number, status: ScheduleMatch["status"] = "scheduled"): ScheduleMatch {
  return {
    id: `${home}-${away}-${at}`,
    competition: "x",
    sport: "x",
    roundLabel: null,
    title: null,
    home,
    away,
    homeLabel: home,
    awayLabel: away,
    startAt: new Date(at).toISOString(),
    dateOnly: null,
    status,
    venue: null,
    isNeutral: false,
    podium: null,
    homeScore: null,
    awayScore: null,
    broadcast: null,
    sequence: 0,
    updatedAt: new Date(NOW).toISOString(),
  };
}

const SPORT: Record<string, string> = { a: "football", b: "baseball", c: "basketball", d: "basketball", e: "volleyball", f: "football" };

describe("첫 방문 예시 팀", () => {
  it("30일 안에 경기가 있는 팀을 종목이 겹치지 않게 앞에서부터 3팀 고른다", () => {
    const matches = [
      match("a", "z", NOW + 2 * DAY),
      match("b", "z", NOW - 3 * DAY), // 지난 경기만 (비시즌)
      match("c", "z", NOW + 1 * DAY),
      match("d", "z", NOW + 1 * DAY), // c 와 같은 종목
      match("f", "z", NOW + 1 * DAY), // a 와 같은 종목
      match("e", "z", NOW + 10 * DAY),
    ];
    expect(pickDemo(matches, ["a", "b", "c", "d", "f", "e"], (s) => SPORT[s], NOW)).toEqual(["a", "c", "e"]);
  });

  it("취소된 경기와 30일 뒤 경기는 세지 않는다", () => {
    const matches = [match("a", "z", NOW + DAY, "cancelled"), match("c", "z", NOW + 40 * DAY), match("e", "z", NOW + DAY)];
    expect(pickDemo(matches, ["a", "c", "e"], (s) => SPORT[s], NOW)).toEqual(["e"]);
  });

  it("후보는 실제로 있는 팀만, API 한도(10팀) 안", () => {
    for (const locale of ["ko", "en"] as const) {
      const list = demoCandidates(locale, () => true);
      expect(list.length).toBeLessThanOrEqual(10);
      expect(demoCandidates(locale, (s) => s !== list[0])).not.toContain(list[0]);
    }
  });
});
