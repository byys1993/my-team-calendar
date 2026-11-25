import { createHash } from "node:crypto";
import type { Db } from "@/lib/db";
import { seoulDay } from "@/lib/visitors";

// 핵심 행동 (화면에서 보내는 이름). 이 목록에 없는 이름은 받지 않는다.
export const EVENTS = [
  "team_pick", // 팀을 하나라도 고름
  "picker_skip", // 아무 팀도 고르지 않고 팀 선택 창을 닫음
  "share", // 내 팀 구성 공유 버튼
  "box_open", // 끝난 경기 기록지를 엶
  "link_add", // 팀 페이지의 '이 팀 추가'로 들어옴
  "sub_open", // 캘린더 구독 창을 엶
  "sub_notice", // 일정 위 안내 칸('캘린더에 넣어 두면…')에서 구독 창을 엶
  "sub_apple", // Apple 캘린더 추가를 누름
  "sub_google", // Google 캘린더 추가를 누름
  "sub_copy", // 구독 주소 복사
  "login", // 로그인 완료
  "notify_on", // 알림 메일 켬
  "contact_sent", // 문의 보냄
  // 화면에서 보내고 있었지만 목록에 없어 버려지던 것 (2026-11-09 추가)
  "league_tab", // 리그 일정 탭을 엶
  "league_tab_pick", // 리그 일정 탭에서 리그를 바꿈
  "league_day_open", // 날짜 패널의 '같은 리그 다른 경기'를 펼침
  // 첫 방문 예시 화면 (2026-11-25 추가)
  "demo_view", // 고른 팀이 없어 예시 팀 일정을 보여 줌
  "demo_pick", // 예시 화면에서 '내 팀 고르기'(또는 팀 선택)를 누름
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
