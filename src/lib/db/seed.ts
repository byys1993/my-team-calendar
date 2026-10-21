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
    display_order?: number;
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
// 매시간 수집 전에 실행되고 DB가 멀리 있을 수 있어, 표마다 한 번씩 묶어서(jsonb_to_recordset) 보낸다.
export async function seed(db: Db, catalog: Catalog): Promise<void> {
  const json = (v: unknown) => JSON.stringify(v);
  const competitions = catalog.competitions.map((c) => ({
    slug: c.slug,
    sport: c.sport,
    name_ko: c.name_ko,
    type: c.type,
    feed: c.feed ?? "auto",
    display_order: c.display_order ?? 100,
  }));
  const sources = catalog.competitions.flatMap((c) =>
    (c.sources ?? []).map((s, priority) => ({ competition: c.slug, source: s.source, external_id: s.external_id, priority })),
  );
  const teams = catalog.teams.map((t) => ({
    slug: t.slug,
    sport: t.sport,
    competition: t.competition,
    name_ko: t.name_ko,
    short_ko: t.short_ko ?? null,
    name_en: t.name_en,
    aliases: t.aliases ?? [],
  }));
  const refs = catalog.teams.flatMap((t) =>
    Object.entries(t.refs ?? {}).map(([source, external_id]) => ({ slug: t.slug, source, external_id })),
  );

  await db.tx(async (t) => {
    await t.query(
      `insert into sport (slug, name_ko)
       select x.slug, x.name_ko from jsonb_to_recordset($1::text::jsonb) as x(slug text, name_ko text)
       on conflict (slug) do update set name_ko = excluded.name_ko`,
      [json(catalog.sports)],
    );
    await t.query(
      `insert into competition (sport_id, slug, name_ko, type, feed, display_order)
       select s.id, x.slug, x.name_ko, x.type, x.feed, x.display_order
       from jsonb_to_recordset($1::text::jsonb) as x(slug text, sport text, name_ko text, type text, feed text, display_order int)
       join sport s on s.slug = x.sport
       on conflict (slug) do update set name_ko = excluded.name_ko, type = excluded.type, feed = excluded.feed,
         display_order = excluded.display_order`,
      [json(competitions)],
    );
    // 시드에 적힌 대회의 소스 목록은 시드 내용으로 통째로 바꾼다
    await t.query(
      `delete from competition_source_ref where competition_id in
         (select id from competition where slug in (select jsonb_array_elements_text($1::text::jsonb)))`,
      [json(competitions.map((c) => c.slug))],
    );
    await t.query(
      `insert into competition_source_ref (competition_id, source, external_id, priority)
       select c.id, x.source, x.external_id, x.priority
       from jsonb_to_recordset($1::text::jsonb) as x(competition text, source text, external_id text, priority int)
       join competition c on c.slug = x.competition`,
      [json(sources)],
    );
    await t.query(
      `insert into team (sport_id, slug, name_ko, short_ko, name_en, aliases, primary_competition_id)
       select s.id, x.slug, x.name_ko, x.short_ko, x.name_en,
         array(select jsonb_array_elements_text(x.aliases)), c.id
       from jsonb_to_recordset($1::text::jsonb)
         as x(slug text, sport text, competition text, name_ko text, short_ko text, name_en text, aliases jsonb)
       join sport s on s.slug = x.sport
       left join competition c on c.slug = x.competition
       on conflict (slug) do update set name_ko = excluded.name_ko, short_ko = excluded.short_ko,
         name_en = excluded.name_en, aliases = excluded.aliases,
         primary_competition_id = excluded.primary_competition_id`,
      [json(teams)],
    );
    await t.query(
      `insert into team_source_ref (team_id, source, external_id)
       select tm.id, x.source, x.external_id
       from jsonb_to_recordset($1::text::jsonb) as x(slug text, source text, external_id text)
       join team tm on tm.slug = x.slug
       on conflict (source, external_id) do update set team_id = excluded.team_id`,
      [json(refs)],
    );
    await t.query(
      `delete from unmapped_team u using jsonb_to_recordset($1::text::jsonb) as x(slug text, source text, external_id text)
       where u.source = x.source and u.external_id = x.external_id`,
      [json(refs)],
    );
  });
}
