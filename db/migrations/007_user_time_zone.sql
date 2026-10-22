-- 사용자가 고른 시간대 (IANA 이름, null = 브라우저 자동). 경기 알림 메일 시각 계산에도 쓴다.
alter table app_user add column time_zone text
