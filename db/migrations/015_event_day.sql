-- 핵심 행동 세기 (방문 → 팀 선택 → 캘린더 구독·알림). 날짜·행동·익명 방문자(해시)만 남겨 하루 단위 '몇 명'을 센다.
create table event_day (
  day     date not null,
  event   text not null,
  visitor text not null,
  primary key (day, event, visitor)
);
alter table event_day enable row level security;
