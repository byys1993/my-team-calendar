-- 팀 홈 경기장 (출처가 경기장을 안 주는 유럽 축구 경기에 홈팀 경기장을 쓴다)
alter table team add column venue text;
alter table team add column venue_city text;
