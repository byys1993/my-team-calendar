-- 다국어 이름 ({"en": "...", "ja": "...", ...}). 한국어는 기존 name_ko 를 그대로 쓴다.
alter table sport add column name_i18n jsonb not null default '{}'::jsonb;
alter table competition add column name_i18n jsonb not null default '{}'::jsonb
