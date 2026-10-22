-- 경기 알림 메일: off(받지 않음) / daily(경기 있는 날) / weekly(매주 월요일, 그 주 경기)
alter table app_user add column notify_mode text not null default 'off' check (notify_mode in ('off', 'daily', 'weekly'));
-- 보낼 시각(그 사람 시간대의 시, 0~23)
alter table app_user add column notify_hour smallint not null default 9 check (notify_hour between 0 and 23);
-- 시간대를 '자동'으로 둔 사람의 마지막 브라우저 시간대 (메일 시각 계산용)
alter table app_user add column last_tz text;
-- 마지막으로 알림을 처리한 날 (그 사람 시간대 기준). 같은 날 두 번 보내지 않는다.
alter table app_user add column last_notified_on date;
