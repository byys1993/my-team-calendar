-- 끝난 경기의 결과 (홈·원정 점수, e스포츠는 세트 승수). 끝나기 전에는 비어 있다.
alter table match add column home_score int;
alter table match add column away_score int;
