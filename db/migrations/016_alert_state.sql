-- 관리자 이상 알림을 같은 문제로 너무 자주 보내지 않도록 마지막 발송 시각을 남긴다
create table alert_state (
  key       text primary key,
  last_sent timestamptz not null
);
alter table alert_state enable row level security;
