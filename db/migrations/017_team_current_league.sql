-- 승격·강등 등으로 팀이 지금 뛰는 리그가 시드와 달라졌을 때, 순위표에서 확인한 현재 리그.
-- 시드(primary_competition_id)는 시드 파일 그대로 두고, 화면은 이 값이 있으면 이것을 쓴다.
alter table team add column current_competition_id int references competition(id);
