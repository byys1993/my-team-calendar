-- 방문자 수: 브라우저마다 무작위 익명 ID(해시만 저장)로 센다. IP·계정과 연결하지 않는다.
-- 지금 접속 중: 최근 신호 시각
create table visitor_presence (
  visitor   text primary key,
  last_seen timestamptz not null
);
create index visitor_presence_last_seen on visitor_presence (last_seen);
-- 날짜별 방문자 (한국 시간 기준 날짜)
create table visitor_day (
  day     date not null,
  visitor text not null,
  primary key (day, visitor)
);
-- 통산 방문자 수 (날짜별 방문자 수의 합). 매번 전체를 세지 않도록 따로 더해 둔다.
create table visitor_total (
  id    smallint primary key default 1 check (id = 1),
  count bigint not null default 0
);
insert into visitor_total (id, count) values (1, 0);
