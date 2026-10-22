import { createHash } from "node:crypto";
import type { Db } from "@/lib/db";

// 방문자 수 세기. 화면이 열려 있는 동안 1분마다 신호를 보내고,
// 최근 2분 안에 신호가 있으면 '접속 중', 한국 시간 기준 오늘 한 번이라도 왔으면 '오늘' 방문자로 센다.

export const ONLINE_WINDOW_SEC = 120;

export interface VisitorStats {
  online: number;
  today: number;
  total: number;
}

// 브라우저가 만든 무작위 ID 모양만 받는다 (UUID 등)
export const isVisitorId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9-]{16,64}$/.test(v);

const hashId = (id: string) => createHash("sha256").update(`visitor:${id}`).digest("hex").slice(0, 32);

export const seoulDay = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

export async function recordVisit(db: Db, id: string, now = new Date()): Promise<VisitorStats> {
  const visitor = hashId(id);
  const day = seoulDay(now);
  await db.query(
    `insert into visitor_presence (visitor, last_seen) values ($1, $2)
     on conflict (visitor) do update set last_seen = excluded.last_seen`,
    [visitor, now.toISOString()],
  );
  const added = await db.query("insert into visitor_day (day, visitor) values ($1, $2) on conflict do nothing returning 1", [
    day,
    visitor,
  ]);
  if (added.length) await db.query("update visitor_total set count = count + 1 where id = 1");
  // 가끔 오래된 접속 기록을 지운다
  if (Math.random() < 0.02) {
    await db.query("delete from visitor_presence where last_seen < $1", [new Date(now.getTime() - 86_400_000).toISOString()]);
  }
  return getStats(db, now);
}

export async function getStats(db: Db, now = new Date()): Promise<VisitorStats> {
  const [row] = await db.query<{ online: number; today: number; total: number }>(
    `select
       (select count(*)::int from visitor_presence where last_seen > $1) as online,
       (select count(*)::int from visitor_day where day = $2) as today,
       (select count::int from visitor_total where id = 1) as total`,
    [new Date(now.getTime() - ONLINE_WINDOW_SEC * 1000).toISOString(), seoulDay(now)],
  );
  return row;
}
