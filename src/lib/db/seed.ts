import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Db } from "./types";

interface Catalog {
  sports: { slug: string; name_ko: string }[];
  competitions: {
    slug: string;
    sport: string;
    name_ko: string;
    type: string;
    feed?: "auto" | "manual";
    sources?: { source: string; external_id: string }[];
  }[];
  teams: {
    slug: string;
    sport: string;
    competition: string;
    name_ko: string;
    short_ko?: string;
    name_en: string;
    aliases?: string[];
    refs?: Record<string, string>;
  }[];
}

// data/seed/*.json 을 파일명 순서대로 합친다 (catalog.json = 종목·대회·축구, 그 외는 종목별 팀)
export async function loadCatalog(dir = path.join(process.cwd(), "data", "seed")): Promise<Catalog> {
  const merged: Catalog = { sports: [], competitions: [], teams: [] };
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  for (const f of files) {
    const part = JSON.parse(await readFile(path.join(dir, f), "utf8")) as Partial<Catalog>;
    merged.sports.push(...(part.sports ?? []));
    merged.competitions.push(...(part.competitions ?? []));
    merged.teams.push(...(part.teams ?? []));
  }
  return merged;
}

// 시드 파일 내용을 DB에 반영한다. 여러 번 실행해도 안전하며, 시드에 없는 데이터는 지우지 않는다.
export async function seed(db: Db, catalog: Catalog): Promise<void> {
  await db.tx(async (t) => {
    for (const s of catalog.sports) {
      await t.query(
        `insert into sport (slug, name_ko) values ($1, $2)
         on conflict (slug) do update set name_ko = excluded.name_ko`,
        [s.slug, s.name_ko],
      );
    }
    for (const c of catalog.competitions) {
      const [{ id }] = await t.query<{ id: number }>(
        `insert into competition (sport_id, slug, name_ko, type, feed)
         values ((select id from sport where slug = $1), $2, $3, $4, $5)
         on conflict (slug) do update set name_ko = excluded.name_ko, type = excluded.type, feed = excluded.feed
         returning id`,
        [c.sport, c.slug, c.name_ko, c.type, c.feed ?? "auto"],
      );
      await t.query("delete from competition_source_ref where competition_id = $1", [id]);
      for (const [i, src] of (c.sources ?? []).entries()) {
        await t.query(
          `insert into competition_source_ref (competition_id, source, external_id, priority) values ($1, $2, $3, $4)`,
          [id, src.source, src.external_id, i],
        );
      }
    }
    for (const tm of catalog.teams) {
      const [{ id }] = await t.query<{ id: number }>(
        `insert into team (sport_id, slug, name_ko, short_ko, name_en, aliases, primary_competition_id)
         values ((select id from sport where slug = $1), $2, $3, $4, $5, $6, (select id from competition where slug = $7))
         on conflict (slug) do update set name_ko = excluded.name_ko, short_ko = excluded.short_ko,
           name_en = excluded.name_en, aliases = excluded.aliases,
           primary_competition_id = excluded.primary_competition_id
         returning id`,
        [tm.sport, tm.slug, tm.name_ko, tm.short_ko ?? null, tm.name_en, tm.aliases ?? [], tm.competition],
      );
      for (const [source, externalId] of Object.entries(tm.refs ?? {})) {
        await t.query(
          `insert into team_source_ref (team_id, source, external_id) values ($1, $2, $3)
           on conflict (source, external_id) do update set team_id = excluded.team_id`,
          [id, source, externalId],
        );
        await t.query("delete from unmapped_team where source = $1 and external_id = $2", [source, externalId]);
      }
    }
  });
}
