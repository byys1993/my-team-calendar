-- 검색엔진 로봇·운영자 접속을 집계에서 빼기 시작하면서, 그 전 숫자(로봇이 섞여 구분할 수 없음)는 비우고 새로 센다
delete from visitor_presence;
delete from visitor_day;
update visitor_total set count = 0;
delete from event_day;
delete from ics_feed
