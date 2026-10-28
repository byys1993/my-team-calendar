import { describe, expect, it } from "vitest";
import { sportsEventJsonLd } from "@/lib/jsonld";
import type { ScheduleMatch } from "@/lib/schedule";

const match = (x: Partial<ScheduleMatch>) =>
  ({ sport: "soccer", status: "scheduled", startAt: "2026-11-01T15:00:00.000Z", venue: "Emirates Stadium", ...x }) as ScheduleMatch;
const names = { home: "아스널", away: "첼시" };
const league = { name: "프리미어리그", url: "https://www.my-team-calendar.com/league/epl" };

describe("이벤트 구조화 데이터", () => {
  it("Google 이 요구·권장하는 항목을 모두 채운다", () => {
    expect(sportsEventJsonLd(match({}), names, league)).toMatchObject({
      name: "아스널 vs 첼시",
      description: "프리미어리그 · 아스널 vs 첼시",
      startDate: "2026-11-01T15:00:00.000Z",
      endDate: "2026-11-01T17:00:00.000Z",
      eventStatus: "https://schema.org/EventScheduled",
      location: { "@type": "Place", name: "Emirates Stadium", address: "Emirates Stadium" },
      performer: [{ name: "아스널" }, { name: "첼시" }],
      organizer: { name: "프리미어리그", url: league.url },
    });
  });

  it("연기된 경기 상태, 종목별 종료 시각", () => {
    const e = sportsEventJsonLd(match({ status: "postponed", sport: "baseball" }), names, league);
    expect(e?.eventStatus).toBe("https://schema.org/EventPostponed");
    expect(e?.endDate).toBe("2026-11-01T18:00:00.000Z");
  });

  it("홈팀 경기장으로 채운 경기는 주소에 도시를 붙인다", () => {
    const e = sportsEventJsonLd(match({ venueCity: "London, England" }), names, league);
    expect(e?.location.address).toBe("Emirates Stadium, London, England");
  });

  it("장소나 시각을 모르면 넣지 않는다", () => {
    expect(sportsEventJsonLd(match({ venue: null }), names, league)).toBeNull();
    expect(sportsEventJsonLd(match({ startAt: null }), names, league)).toBeNull();
  });
});
