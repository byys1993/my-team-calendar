-- F1 같은 순위 경기의 결과 (상위 3명, 예선은 폴 포지션 1명): [{pos, driverId, code, name, team}]
alter table match add column podium jsonb;
-- 리그 순위표. 대회마다 종류(kind)별로 한 줄: 보통 'teams', F1 은 'drivers'·'constructors'.
-- groups: [{name, rows: [{rank, team (팀 slug 또는 null), name, stats: {...}}]}]
create table standing (
  competition_id int  not null references competition(id) on delete cascade,
  kind           text not null,
  season         text,
  groups         jsonb not null,
  source         text not null,
  updated_at     timestamptz not null default now(),
  primary key (competition_id, kind)
);
alter table standing enable row level security;
