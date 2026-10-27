-- 캘린더 구독 주소별 마지막 호출 시각. 캘린더 앱이 주기적으로 다시 받아 가므로 '최근 7일 안에 불린 주소 수'로 구독 규모를 가늠한다.
-- 개인정보 없이 팀 목록·언어만 남긴다 (같은 팀 조합을 구독한 여러 사람은 하나로 센다).
create table ics_feed (
  feed       text primary key,
  teams      text not null,
  lang       text not null,
  first_seen timestamptz not null,
  last_seen  timestamptz not null,
  hits       int not null default 1
);
create index ics_feed_last_seen on ics_feed (last_seen);
alter table ics_feed enable row level security;
