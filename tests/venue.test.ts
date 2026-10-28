import { describe, expect, it } from "vitest";
import { upsertMatches } from "@/collector/upsert";
import { getMatchesForTeams } from "@/lib/schedule";
import { espnMatch, setupDb } from "./helpers";

describe("경기장: 출처에 없으면 홈팀 경기장", () => {
  it("일반 경기는 홈팀 경기장·도시, 출처 경기장·중립 경기·결승은 그대로", async () => {
    const { db, eplId } = await setupDb();
    await db.query("update team set venue = 'Emirates Stadium', venue_city = 'London, England' where slug = 'arsenal'");
    await upsertMatches(db, eplId, "espn", [
      espnMatch({ externalId: "1", venue: null }),
      espnMatch({ externalId: "2", venue: "Wembley Stadium", startAt: "2026-10-25T14:00:00.000Z" }),
      espnMatch({ externalId: "3", venue: null, isNeutral: true, startAt: "2026-10-26T14:00:00.000Z" }),
      espnMatch({ externalId: "4", venue: null, roundLabel: "@stage:final", startAt: "2026-10-27T14:00:00.000Z" }),
    ]);
    const list = await getMatchesForTeams(db, ["arsenal"], "ko");
    expect(list.map((m) => [m.venue, m.venueCity])).toEqual([
      ["Emirates Stadium", "London, England"],
      ["Wembley Stadium", null],
      [null, null],
      [null, null],
    ]);
  });
});
