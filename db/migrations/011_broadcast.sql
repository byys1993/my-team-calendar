-- 국내 중계 채널: 경기별(공식 일정 데이터에 있을 때)과 대회 기본값(시즌 중계권, 시드에서 관리)
alter table match add column broadcast text;
alter table competition add column broadcast text;
