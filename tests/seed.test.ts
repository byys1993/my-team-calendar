import { describe, expect, it } from "vitest";
import { createMemoryDb } from "@/lib/db/pglite";
import { migrate } from "@/lib/db/migrate";
import { loadCatalog, seed } from "@/lib/db/seed";

describe("data/seed/catalog.json", () => {
  it("팀 slug와 소스별 팀 ID가 겹치지 않고, 참조하는 대회가 모두 있다", async () => {
    const catalog = await loadCatalog();
    const slugs = new Set<string>();
    const refs = new Set<string>();
    const comps = new Set(catalog.competitions.map((c) => c.slug));
    for (const t of catalog.teams) {
      expect(slugs.has(t.slug), `중복 slug: ${t.slug}`).toBe(false);
      slugs.add(t.slug);
      expect(comps.has(t.competition), `${t.slug}: 없는 대회 ${t.competition}`).toBe(true);
      for (const [source, id] of Object.entries(t.refs ?? {})) {
        const key = `${source}:${id}`;
        expect(refs.has(key), `${t.slug}: 다른 팀과 겹치는 ${key}`).toBe(false);
        refs.add(key);
      }
    }
  });

  it("DB에 두 번 반영해도 안전하다", async () => {
    const db = await createMemoryDb();
    try {
      await migrate(db);
      const catalog = await loadCatalog();
      await seed(db, catalog);
      await seed(db, catalog);
      const [{ n }] = await db.query<{ n: number }>("select count(*)::int as n from team");
      expect(n).toBe(catalog.teams.length);
    } finally {
      await db.close();
    }
  });
});
