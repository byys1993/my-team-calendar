-- 수집 스크립트가 실행될 때마다 남기는 시각. 새벽처럼 갱신할 대회가 없어도 '수집이 돌고 있다'는 것을 알 수 있게 한다
create table sync_heartbeat (
  id     smallint primary key,
  ran_at timestamptz not null
);
alter table sync_heartbeat enable row level security;
