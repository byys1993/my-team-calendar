import { createMemoryDb } from "@/lib/db/pglite";
import { migrate } from "@/lib/db/migrate";
import { seed } from "@/lib/db/seed";
import type { SourceMatch } from "@/collector/types";

export async function setupDb() {
  const db = await createMemoryDb();
  await migrate(db);
  await seed(db, {
    sports: [{ slug: "soccer", name_ko: "축구" }],
    competitions: [
      {
        slug: "epl",
        sport: "soccer",
        name_ko: "프리미어리그",
        type: "league",
        sources: [
          { source: "football-data", external_id: "PL" },
          { source: "espn", external_id: "soccer/eng.1" },
        ],
      },
    ],
    teams: [
      { slug: "arsenal", sport: "soccer", competition: "epl", name_ko: "아스널", name_en: "Arsenal", refs: { espn: "359" } },
      { slug: "everton", sport: "soccer", competition: "epl", name_ko: "에버턴", name_en: "Everton", refs: { espn: "368" } },
      {
        slug: "man-city",
        sport: "soccer",
        competition: "epl",
        name_ko: "맨체스터 시티",
        name_en: "Manchester City",
        aliases: ["Man City"],
        refs: { espn: "382" },
      },
    ],
  });
  const [{ id: eplId }] = await db.query<{ id: number }>("select id from competition where slug = 'epl'");
  return { db, eplId };
}

// football-data 형식의 경기 (팀 ID는 football-data 기준)
export function fdMatch(overrides: Partial<SourceMatch> = {}): SourceMatch {
  return {
    externalId: "537001",
    season: "2026",
    roundLabel: "@md:9",
    home: { externalId: "57", name: "Arsenal FC", shortName: "Arsenal" },
    away: { externalId: "62", name: "Everton FC", shortName: "Everton" },
    startAt: "2026-10-24T14:00:00Z",
    status: "scheduled",
    venue: null,
    ...overrides,
  };
}

// 같은 경기를 ESPN에서 받은 형태
export function espnMatch(overrides: Partial<SourceMatch> = {}): SourceMatch {
  return {
    externalId: "401878768",
    season: "2026",
    home: { externalId: "359", name: "Arsenal" },
    away: { externalId: "368", name: "Everton" },
    startAt: "2026-10-24T14:00:00.000Z",
    status: "scheduled",
    venue: "Emirates Stadium",
    ...overrides,
  };
}
