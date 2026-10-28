-- 끝난 경기의 기록지. 누가 처음 열어 볼 때 출처에서 받아 저장하고, 3년(3시즌) 지난 것은 정리한다 (다시 열면 그때 또 받는다)
create table boxscore (
  match_id   uuid primary key references match(id) on delete cascade,
  data       jsonb not null,
  fetched_at timestamptz not null
);
alter table boxscore enable row level security;
