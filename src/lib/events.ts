import { createHash } from "node:crypto";
import type { Db } from "@/lib/db";
import { seoulDay } from "@/lib/visitors";

// 핵심 행동 (화면에서 보내는 이름). 이 목록에 없는 이름은 받지 않는다.
export const EVENTS = [
  "team_pick", // 팀을 하나라도 고름
  "share", // 내 팀 구성 공유 버튼
  "link_add", // 팀 페이지의 '이 팀 추가'로 들어옴
  "sub_open", // 캘린더 구독 창을 엶
  "sub_apple", // Apple 캘린더 추가를 누름
  "sub_google", // Google 캘린더 추가를 누름
  "sub_copy", // 구독 주소 복사
  "login", // 로그인 완료
  "notify_on", // 알림 메일 켬
  "contact_sent", // 문의 보냄
] as const;
export type EventName = (typeof EVENTS)[number];
export const isEventName = (v: unknown): v is EventName => EVENTS.includes(v as EventName);

const hashId = (id: string) => createHash("sha256").update(`visitor:${id}`).digest("hex").slice(0, 32);

export async function recordEvent(db: Db, visitorId: string, event: EventName, now = new Date()): Promise<void> {
  await db.query("insert into event_day (day, event, visitor) values ($1, $2, $3) on conflict do nothing", [
    seoulDay(now),
    event,
    hashId(visitorId),
  ]);
}

export interface FunnelRow {
  days: number;
  visitors: number;
  events: Record<EventName, number>;
}

// 최근 N일 동안 행동별로 '한 번이라도 한 사람' 수
export async function funnel(db: Db, days: number, now = new Date()): Promise<FunnelRow> {
  // now 를 포함한 N일 (한국 날짜 기준 from ~ to)
  const from = seoulDay(new Date(now.getTime() - (days - 1) * 86_400_000));
  const to = seoulDay(now);
  const [v] = await db.query<{ n: number }>(
    "select count(distinct visitor)::int as n from visitor_day where day between $1 and $2",
    [from, to],
  );
  const rows = await db.query<{ event: string; n: number }>(
    "select event, count(distinct visitor)::int as n from event_day where day between $1 and $2 group by event",
    [from, to],
  );
  const events = Object.fromEntries(EVENTS.map((e) => [e, 0])) as Record<EventName, number>;
  for (const r of rows) if (isEventName(r.event)) events[r.event] = r.n;
  return { days, visitors: v.n, events };
}
