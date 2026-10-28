import { describe, expect, it } from "vitest";
import { parseF1, parseF1Ref, type JolpicaClassified } from "@/lib/boxscoreF1";

const driver = (id: string, team: string) => ({ Driver: { driverId: id, familyName: id }, Constructor: { name: team } });

describe("F1 기록지", () => {
  it("경기 ID → 시즌·라운드·세션 (OpenF1 숫자 ID 는 제외)", () => {
    expect(parseF1Ref("2026-18-race")).toEqual({ season: "2026", round: "18", kind: "race" });
    expect(parseF1Ref("2026-5-quali")).toEqual({ season: "2026", round: "5", kind: "quali" });
    expect(parseF1Ref("9876")).toBeNull();
  });

  it("결승: 순위·출발·기록(랩 뒤처짐은 +nL)·포인트, 리타이어는 DNF, 패스티스트 랩", () => {
    const r = (x: Partial<JolpicaClassified> & { position: string }, id: string): JolpicaClassified => ({
      ...driver(id, "Mercedes"),
      grid: "1",
      laps: "56",
      status: "Finished",
      points: "0",
      ...x,
    });
    const box = parseF1("race", {
      Results: [
        r({ position: "2", Time: { time: "+13.078" }, points: "18", grid: "0" }, "russell"),
        r(
          { position: "1", Time: { time: "1:35:16.650" }, points: "25", FastestLap: { rank: "1", Time: { time: "1:38.123" } } },
          "antonelli",
        ),
        r({ position: "3", laps: "55", status: "Lapped", Time: { time: "+6.344" } }, "bottas"),
        r({ position: "4", positionText: "R", laps: "24", status: "Retired" }, "bearman"),
      ],
    });
    expect(box?.source).toBe("jolpica");
    expect(box?.f1?.rows.map((x) => [x.pos, x.driverId, x.grid, x.time, x.pts, x.fastest])).toEqual([
      ["1", "antonelli", "1", "1:35:16.650", "25", true],
      ["2", "russell", "PL", "+13.078", "18", false],
      ["3", "bottas", "1", "+1L", "0", false],
      ["DNF", "bearman", "1", "", "0", false],
    ]);
    expect(box?.f1?.fastestLap).toEqual({ driverId: "antonelli", name: "antonelli", team: "Mercedes", time: "1:38.123" });
  });

  it("예선: Q1~Q3 기록 (떨어진 구간은 빈칸)", () => {
    const box = parseF1("quali", {
      QualifyingResults: [
        { position: "1", Q1: "1:33.1", Q2: "1:32.5", Q3: "1:32.0", ...driver("norris", "McLaren") },
        { position: "20", Q1: "1:37.4", ...driver("perez", "Cadillac F1 Team") },
      ],
    });
    expect(box?.f1?.rows.map((x) => [x.pos, x.q])).toEqual([
      ["1", ["1:33.1", "1:32.5", "1:32.0"]],
      ["20", ["1:37.4", "", ""]],
    ]);
  });

  it("결과가 아직 없으면 기록지를 만들지 않는다", () => {
    expect(parseF1("sprint", {})).toBeNull();
  });
});
