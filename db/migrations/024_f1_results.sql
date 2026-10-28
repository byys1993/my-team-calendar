-- F1 세션의 전체 순위 (팀·드라이버 선택 사용자에게 '해밀턴 7위' 를 보여 준다). podium 은 목록용 1~3위·폴 포지션 그대로
alter table match add column results jsonb;
