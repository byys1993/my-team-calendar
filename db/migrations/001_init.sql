-- 마이팀 캘린더 초기 스키마. 모든 시각은 UTC(timestamptz)로 저장한다.

create table sport (
  id      serial primary key,
  slug    text not null unique,
  name_ko text not null
);

create table competition (
  id         serial primary key,
  sport_id   int  not null references sport(id),
  slug       text not null unique,
  name_ko    text not null,
  type       text not null check (type in ('league', 'cup', 'intl', 'esports', 'motorsport')),
  -- 포스트시즌 등 매시간 갱신이 필요한 기간이면 true (수동 관리)
  postseason boolean not null default false,
  -- 'auto' = 외부 소스 수집, 'manual' = CSV·관리자 입력 (KBO·KBL)
  feed       text not null default 'auto' check (feed in ('auto', 'manual'))
);

-- 대회별 데이터 소스. priority 오름차순으로 시도하고 실패하면 다음 소스로 넘어간다.
create table competition_source_ref (
  competition_id int  not null references competition(id) on delete cascade,
  source         text not null,
  external_id    text not null,
  priority       int  not null,
  primary key (competition_id, source)
);

create table team (
  id                     serial primary key,
  sport_id               int  not null references sport(id),
  slug                   text not null unique,
  name_ko                text not null,
  name_en                text not null,
  short_ko               text,
  -- 팀 선택 화면에서 묶어 보여줄 대표 리그
  primary_competition_id int references competition(id),
  -- 소스별 표기 차이를 자동 매칭할 때 쓰는 영문 별칭
  aliases                text[] not null default '{}'
);

-- 소스의 팀 ID → 우리 팀. 이름이 아니라 ID로 매핑한다.
create table team_source_ref (
  team_id     int  not null references team(id) on delete cascade,
  source      text not null,
  external_id text not null,
  raw_name    text,
  primary key (source, external_id)
);

-- 매핑하지 못한 팀. 관리자가 한 번 연결하면 이후 자동 처리된다.
create table unmapped_team (
  source         text not null,
  external_id    text not null,
  raw_name       text not null,
  competition_id int references competition(id) on delete cascade,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  primary key (source, external_id)
);

create table match (
  -- 처음 생성된 뒤 절대 바뀌지 않는 고유 ID (추후 ICS UID로 사용)
  id               uuid primary key default gen_random_uuid(),
  competition_id   int  not null references competition(id),
  season           text not null,
  round_label      text,
  home_team_id     int references team(id),
  away_team_id     int references team(id),
  home_placeholder text,
  away_placeholder text,
  -- 시간이 미정이어도 잠정 시각이 있으면 start_at에 넣고 status = 'time_tbd'
  start_at         timestamptz,
  -- 시각 없이 날짜만 아는 경우 (수동 입력)
  date_only        date,
  status           text not null default 'scheduled'
                   check (status in ('scheduled', 'time_tbd', 'conditional', 'draw_pending', 'postponed', 'cancelled')),
  venue            text,
  is_neutral       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- 일정이 바뀔 때마다 +1 (ICS SEQUENCE)
  sequence         int not null default 0,
  check (start_at is not null or date_only is not null)
);
create index match_home_idx on match (home_team_id);
create index match_away_idx on match (away_team_id);
create index match_comp_start_idx on match (competition_id, start_at);

-- 소스의 경기 ID → 우리 경기 ID. 대체 소스 경기도 같은 match에 연결된다.
create table match_source_ref (
  match_id    uuid not null references match(id) on delete cascade,
  source      text not null,
  external_id text not null,
  primary key (source, external_id)
);
create index match_source_ref_match_idx on match_source_ref (match_id);

-- 수집 실행 기록 (성공·실패 모두)
create table sync_run (
  id             bigserial primary key,
  competition_id int  not null references competition(id) on delete cascade,
  source         text not null,
  is_fallback    boolean not null default false,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  ok             boolean not null default false,
  fetched        int not null default 0,
  inserted       int not null default 0,
  updated        int not null default 0,
  skipped        int not null default 0,
  error          text
);
create index sync_run_comp_idx on sync_run (competition_id, started_at desc);

-- 화면의 '마지막 업데이트' 표시와 수집 주기 판단용
create table competition_status (
  competition_id  int primary key references competition(id) on delete cascade,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_source     text
);
