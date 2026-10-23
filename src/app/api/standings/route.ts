import { NextResponse } from "next/server";
import { isLocale, type Locale } from "@/i18n/config";
import { getDb } from "@/lib/db";

// GET /api/standings → 순위표가 있는 대회 목록 [{slug, name, sport}]
// GET /api/standings?c=epl → 그 대회의 순위표 [{kind, season, source, updatedAt, groups}]
// 팀 이름은 화면이 가진 팀 목록(slug)으로 바꾸고, 연결되지 않은 팀은 원문 이름을 쓴다.
const CACHE = { "Cache-Control": "public, max-age=0, s-maxage=600, stale-while-revalidate=1800" };

const localName = `case when $1 = 'ko' then c.name_ko else coalesce(c.name_i18n->>$1, c.name_i18n->>'en', c.name_ko) end`;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang");
  const locale: Locale = isLocale(lang) ? lang : "ko";
  const slug = url.searchParams.get("c");
  const db = getDb();
  if (!slug) {
    const list = await db.query<{ slug: string; name: string; sport: string }>(
      `select c.slug, ${localName} as name, s.slug as sport from competition c join sport s on s.id = c.sport_id
       where exists (select 1 from standing st where st.competition_id = c.id)
       order by c.display_order, c.id`,
      [locale],
    );
    return NextResponse.json({ competitions: list }, { headers: CACHE });
  }
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const tables = await db.query<{ kind: string; season: string | null; source: string; updated_at: Date; groups: unknown }>(
    `select st.kind, st.season, st.source, st.updated_at, st.groups from standing st
     join competition c on c.id = st.competition_id where c.slug = $1
     order by case st.kind when 'teams' then 0 when 'drivers' then 1 else 2 end`,
    [slug],
  );
  return NextResponse.json(
    {
      tables: tables.map((t) => ({
        kind: t.kind,
        season: t.season,
        source: t.source,
        updatedAt: t.updated_at.toISOString(),
        groups: t.groups,
      })),
    },
    { headers: CACHE },
  );
}
