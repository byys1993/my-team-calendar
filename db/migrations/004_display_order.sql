-- 팀 선택 화면에서 대회를 보여줄 순서 (작을수록 앞). 국내 리그를 해외 리그보다 먼저 보여준다.
alter table competition add column display_order int not null default 100
