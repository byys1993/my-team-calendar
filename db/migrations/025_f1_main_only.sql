-- F1 '주요 세션만' (결승·예선·스프린트만, 연습 주행·스프린트 예선은 뺀다). 알림 메일에 쓴다 (화면·구독 주소는 f1=main)
alter table app_user add column f1_main_only boolean not null default false
