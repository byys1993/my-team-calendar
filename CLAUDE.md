# 마이팀 캘린더 — 작업 안내 (Claude 용)

## 사용자와 일하는 방식
- **항상 한국어로 답한다.** 버튼 문구가 영어여도 한국어로.
- 사용자는 개발자가 아니다. 대시보드 설정 등은 클릭할 메뉴를 순서대로 안내한다.
- 비밀값(API 키·비밀번호)은 채팅에 붙여넣지 말라고 안내하고, 직접 각 서비스에 넣게 한다. 계정 생성·비밀번호 입력은 사용자가 한다.
- 기능을 마치면 테스트 → 커밋 → `main` 에 push(자동 배포)까지 하고 결과를 확인해 보고한다.
- 커밋 메시지는 한국어, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## 서비스
응원 팀을 고르면 리그·컵·국제대회·e스포츠 일정이 한 캘린더에 모이는 비상업 사이트.
- 운영: https://www.my-team-calendar.com (Vercel Hobby, 서울 리전 icn1)
- 저장소: github.com/byys1993/my-team-calendar (비공개, `main` push = 배포)
- DB: Supabase Postgres (서울, Transaction pooler 6543). 모든 public 테이블 RLS 켜짐(정책 없음 → 공개 API 차단, 서버는 테이블 주인이라 영향 없음). **새 테이블을 만들면 마이그레이션에 `enable row level security` 를 꼭 넣는다** (`tests/rls.test.ts` 가 잡아냄).
- 정기 수집: GitHub Actions `sync-schedules` 매시간(정시 보장 안 됨) → `npm run sync` (일정 + 순위표) → 끝에 `/api/cron/notify` 호출
- 알림 메일 정시 호출: Cloudflare Worker `my-team-calendar-cron` 10분마다 (`cloudflare/notify-cron.js`)
- 메일: Resend (`mail.my-team-calendar.com`, 무료 하루 100통 → 한 번에 최대 80통), 문의 메일은 ImprovMX 로 사용자 Gmail 에 전달
- 로그인 보호: Cloudflare Turnstile
- 비밀값 위치: Vercel(DATABASE_URL, ADMIN_PASSWORD, AUTH_SECRET, RESEND_API_KEY, MAIL_FROM, CONTACT_EMAIL, CRON_SECRET, TURNSTILE_SITE_KEY/SECRET_KEY — 모두 Production 전용), GitHub Secrets(DATABASE_URL, FOOTBALL_DATA_API_KEY, CRON_SECRET), Cloudflare Worker(CRON_SECRET)

## 기술 구성
- Next.js 15 App Router + TypeScript, React 19. 스타일은 `src/app/globals.css` 하나 (색은 CSS 변수, 다크 모드 지원)
- DB 접근: postgres.js(`prepare: false`, 운영 max 1). **운영에서 한 연결로 여러 조회를 `Promise.all` 로 동시에 보내면 Supabase 풀러에서 응답이 멈춘다(5분 타임아웃, 로컬에선 재현 안 됨) → DB 조회는 항상 차례로 await**. 대량 쓰기는 `jsonb_to_recordset($1::text::jsonb)` 로 한 번에 (값을 JSON 문자열로 넘기고 `::text::jsonb`)
- 마이그레이션: `db/migrations/NNN_*.sql` 순서대로 1회 적용. **`;` 로 문장을 나누므로 함수 본문·DO 블록 금지**. Vercel 빌드(`vercel-build`)와 Actions 가 `db:setup`(마이그레이션 + 시드)를 실행
- 시드: `data/seed/*.json` (대회·팀·한국어 이름·국내 중계 기본값 `broadcast`). 수정하면 다음 배포/수집 때 반영
- 다국어 10개(ko,en,zh,ja,es,fr,de,pt,ru,ar): `src/i18n/messages/*.ts` (타입 기준은 en.ts) — **문구를 추가하면 10개 파일 모두에** 넣는다. 라운드 등은 언어 중립 토큰(`@md:9`, `@series:kbo_ks|@game:3`, `@intl:asian_cup` …)으로 저장하고 `src/i18n/format.ts` 가 바꾼다

## 주요 폴더
- `src/collector/sources/*` 출처별 수집기 → `SourceMatch` → `upsert.ts` (경기 ID 유지, 일정 바뀌면 sequence+1)
  - football-data(유럽 리그·UCL), espn(미국 리그·컵대회·대한민국 A매치 `team:451`), jolpica/openf1(F1·결과 포디움), mlb, nhl, lolesports, kbo·kbl·kleague(공식 홈페이지 비공개 API/HTML)
  - 중계 채널: 경기별(K리그·KBO·KBL 공식 데이터) + 대회 기본값(시드 `broadcast`) 합침
  - 결과: `home_score/away_score`(끝난 경기만), F1 은 `podium`
- `src/collector/standings.ts` 순위표, `leaders.ts` 개인 순위 TOP 5 → `standing` 표(kind: teams/drivers/constructors/leaders), 대회마다 3시간마다
- `src/lib/notify.ts` 알림 메일(각자 시간대·시각, 하루 1통, 보내기 전 선점으로 중복 방지), `ics.ts` 캘린더 구독, `visitors.ts` 방문자 수, `cleanup.ts` 오래된 기록 정리
- `src/components/CalendarApp.tsx` 메인 화면(캘린더 / 순위 탭), `RecordsView.tsx` 순위 탭, `spoiler.tsx` 결과·스포일러 방지
- `src/app/admin` 관리자(ADMIN_PASSWORD, IP당 시간당 10회)
- 자세한 배포·설정 절차: `docs/DEPLOY.md`, 시즌 전환: `docs/SEASON.md`
- 운영 점검: 데이터 이상 감지 메일(`src/lib/health.ts`, 10분마다 점검), 관리자 현황의 이용 흐름(`src/lib/events.ts`)

## 로컬 개발 (Windows)
```bash
npm ci
npm run db:local        # 다른 터미널에서 계속 켜 둔다 (PGlite, 5433)
npm run db:setup
npm run sync -- --force --only epl,kbo   # 일부 대회만 수집
npm run dev
```
- `.env.local` 은 저장소에 없다 (`.env.example` 참고). 로컬 DB 는 `postgres://postgres:postgres@127.0.0.1:5433/postgres`
- 검사: `npx tsc --noEmit`, `npx eslint src tests`, `npx vitest run` (테스트는 메모리 PGlite 사용, 외부 접속 없음)
- `next build` 를 로컬에서 돌리면 `.next` 가 바뀌어 dev 서버가 꼬일 수 있다 → 빌드 후 `.next` 를 지우고 dev 재시작
- bash heredoc 으로 파일을 고치면 `\\` 가 사라질 수 있다. 정규식·이스케이프가 있는 수정은 Edit 도구로

## 주의할 출처 특성
- K리그: 월은 두 자리('03'), 순위는 GET 쿼리스트링(POST 본문이면 리그 번호 무시), `Accept-Language: ko-KR` 필요(없으면 영어)
- KBL: `Channel: WEB`, `TeamCode` 헤더 필요. 남은 시즌 경기의 중계 채널은 늦게 정해짐
- football-data 무료 키는 분당 10회 → 순위·득점 요청 사이 7초
- ESPN 축구 scoreboard 날짜 범위 조회는 막혀 있어 팀별 일정(fixture=true + 결과)을 합친다
