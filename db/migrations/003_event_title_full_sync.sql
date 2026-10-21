-- 상대가 없는 이벤트형 경기(F1 그랑프리 결승·예선 등)의 제목
alter table match add column title text;

-- 전체 일정 수집 시각. 경기 당일의 매시간 수집은 최근 일정만 받아 요청 수를 줄이고,
-- 전체 수집은 12시간마다 한다.
alter table competition_status add column last_full_at timestamptz
