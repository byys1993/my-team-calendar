-- 이메일 인증코드 로그인. 비밀번호는 없고, 코드와 세션 토큰은 해시로만 저장한다.
create table app_user (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique, -- 소문자로 저장
  locale        text,
  -- 선택한 팀 [{slug, color, enabled}] (브라우저 localStorage 와 같은 모양)
  selections    jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

-- 이메일당 최근 코드 하나. 재발송 간격·시간당 발송 수·입력 시도 수를 함께 센다.
create table login_code (
  email        text primary key,
  code_hash    text not null,
  expires_at   timestamptz not null,
  attempts     int not null default 0,
  last_sent_at timestamptz not null default now(),
  window_start timestamptz not null default now(),
  sent_count   int not null default 1
);

create table user_session (
  token_hash text primary key,
  user_id    uuid not null references app_user(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index user_session_user_idx on user_session (user_id)
;

-- 요청 횟수 제한 (예: IP 당 시간당 코드 요청 수). key 는 'code-ip:<IP 해시>' 처럼 용도를 붙인다.
create table rate_limit (
  key          text primary key,
  window_start timestamptz not null,
  count        int not null
)
