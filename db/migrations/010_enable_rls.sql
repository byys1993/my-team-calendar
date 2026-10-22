-- Supabase 는 public 스키마 테이블을 공개 API(Data API, anon 키)로 노출한다. 이 사이트는 그 API 를 쓰지 않고
-- 서버만 DB 에 직접 접속하므로, 모든 테이블에 RLS 를 켜고 정책은 두지 않아 공개 API 로는 아무것도 읽고 쓸 수 없게 한다.
-- 테이블 주인(서버가 접속하는 계정)은 RLS 를 적용받지 않아 사이트·수집기는 그대로 동작한다.
-- 새 테이블을 만들 때도 같은 줄을 추가할 것 (tests/rls.test.ts 가 빠진 테이블을 잡아낸다).
alter table schema_migrations enable row level security;
alter table sport enable row level security;
alter table competition enable row level security;
alter table competition_source_ref enable row level security;
alter table team enable row level security;
alter table team_source_ref enable row level security;
alter table unmapped_team enable row level security;
alter table match enable row level security;
alter table match_source_ref enable row level security;
alter table sync_run enable row level security;
alter table competition_status enable row level security;
alter table app_user enable row level security;
alter table login_code enable row level security;
alter table user_session enable row level security;
alter table rate_limit enable row level security;
alter table visitor_presence enable row level security;
alter table visitor_day enable row level security;
alter table visitor_total enable row level security;
