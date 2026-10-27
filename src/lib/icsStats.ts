import type { Db } from "@/lib/db";

// 캘린더 구독 주소가 불릴 때마다 기록한다 (CDN 캐시 때문에 주소마다 30분에 한 번 정도만 실제로 불린다)
export async function recordIcsFetch(db: Db, slugs: string[], lang: string, now = new Date()): Promise<void> {
  const teams = [...slugs].sort().join(",");
  await db.query(
    `insert into ics_feed (feed, teams, lang, first_seen, last_seen) values ($1, $2, $3, $4, $4)
     on conflict (feed) do update set last_seen = excluded.last_seen, hits = ics_feed.hits + 1`,
    [`${teams}|${lang}`, teams, lang, now.toISOString()],
  );
}

export interface IcsStats {
  active7d: number; // 최근 7일 안에 캘린더 앱이 불러간 구독 주소 수
  total: number;
}

export async function getIcsStats(db: Db, now = new Date()): Promise<IcsStats> {
  const [row] = await db.query<IcsStats>(
    `select (select count(*)::int from ics_feed where last_seen > $1) as "active7d",
            (select count(*)::int from ics_feed) as total`,
    [new Date(now.getTime() - 7 * 86_400_000).toISOString()],
  );
  return row;
}
