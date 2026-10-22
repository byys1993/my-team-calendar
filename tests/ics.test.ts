import { describe, expect, it } from "vitest";
import { buildIcs, foldLine, parseTeamList } from "@/lib/ics";
import type { Catalog, ScheduleMatch } from "@/lib/schedule";

const catalog = {
  sports: [],
  teams: [],
  competitions: [{ slug: "epl", name: "프리미어리그", sport: "soccer", type: "league", lastSuccessAt: null, lastSource: null }],
} as Catalog;

// 75바이트마다 접힌 줄을 다시 편다
const unfold = (s: string) => s.replace(/\r\n /g, "");

const match = (o: Partial<ScheduleMatch> = {}): ScheduleMatch => ({
  id: "11111111-2222-3333-4444-555555555555",
  competition: "epl",
  sport: "soccer",
  roundLabel: "@md:9",
  title: null,
  home: "tottenham",
  away: "chelsea",
  homeLabel: "토트넘",
  awayLabel: "첼시",
  startAt: "2026-10-24T16:30:00.000Z",
  dateOnly: null,
  status: "scheduled",
  venue: "Tottenham Hotspur Stadium",
  isNeutral: false,
  sequence: 2,
  updatedAt: "2026-10-20T01:02:03.000Z",
  ...o,
});

describe("캘린더 구독 (ICS)", () => {
  it("팀 목록 주소 검증", () => {
    expect(parseTeamList("tottenham,kl-ulsan-hd")).toEqual(["tottenham", "kl-ulsan-hd"]);
    expect(parseTeamList("a,a")).toEqual(["a"]);
    expect(parseTeamList("")).toBeNull();
    expect(parseTeamList("bad slug")).toBeNull();
    expect(parseTeamList(Array.from({ length: 11 }, (_, i) => `t${i}`).join(","))).toBeNull();
  });

  it("경기 하나: 고정 UID, UTC 시각, 종목별 길이, 변경 횟수", () => {
    const raw = buildIcs({ matches: [match()], catalog, locale: "ko", siteUrl: "https://example.com" });
    const ics = unfold(raw);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("UID:11111111-2222-3333-4444-555555555555@my-team-calendar.com\r\n");
    expect(ics).toContain("DTSTART:20261024T163000Z\r\nDTEND:20261024T183000Z\r\n");
    expect(ics).toContain("SUMMARY:⚽ 토트넘 vs 첼시\r\n");
    expect(ics).toContain("DESCRIPTION:프리미어리그 · 9라운드\\nhttps://example.com\r\n");
    expect(ics).toContain("SEQUENCE:2\r\n");
    expect(ics).toContain("STATUS:CONFIRMED\r\n");
    expect(ics).toContain("X-WR-CALNAME:마이팀 캘린더\r\n");
    // 모든 줄이 75바이트 이하
    for (const line of raw.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it("시간 미정은 종일 일정, 취소·진출 시 표시, 특수문자 이스케이프", () => {
    const ics = unfold(buildIcs({
      matches: [
        match({ id: "a", startAt: null, dateOnly: "2026-11-01", status: "time_tbd" }),
        match({ id: "b", status: "cancelled" }),
        match({ id: "c", status: "conditional", venue: "Stadium; North, Gate" }),
      ],
      catalog,
      locale: "ko",
      siteUrl: "https://example.com",
    }));
    expect(ics).toContain("DTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261102\r\n");
    expect(ics).toContain("SUMMARY:⚽ 토트넘 vs 첼시 (취소)\r\n");
    expect(ics).toContain("STATUS:CANCELLED\r\n");
    expect(ics).toContain("SUMMARY:⚽ 토트넘 vs 첼시 (진출 시)\r\n");
    expect(ics).toContain("STATUS:TENTATIVE\r\n");
    expect(ics).toContain("LOCATION:Stadium\\; North\\, Gate\r\n");
  });

  it("긴 줄은 글자가 깨지지 않게 75바이트마다 접는다", () => {
    const long = `SUMMARY:${"가".repeat(40)}`;
    const folded = foldLine(long);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.slice(1).every((p) => p.startsWith(" "))).toBe(true);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(long);
  });
});
