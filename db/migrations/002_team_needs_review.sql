-- 주 소스에서 처음 본 상대팀을 자동으로 만든 경우 true. 한국어 이름을 채운 뒤 false로 바꾼다.
alter table team add column needs_review boolean not null default false
