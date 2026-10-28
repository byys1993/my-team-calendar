-- 승부차기로 끝난 경기의 승부차기 점수 (정규·연장 점수는 home_score/away_score 그대로)
alter table match add column home_pen int;
alter table match add column away_pen int
