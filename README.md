# 마이팀 캘린더

응원하는 팀을 고르면 그 팀의 리그·컵·국제대회 일정을 사이트 안 캘린더에 모아 보여주는 비상업 개인 프로젝트입니다.

- 사이트(Next.js)는 **DB만 읽습니다**. 외부 API는 정기 수집 작업(`npm run sync`, GitHub Actions)만 호출합니다.
- 경기마다 바뀌지 않는 UUID(`match.id`)를 부여합니다. 일정이 바뀌어도 같은 ID를 유지하며, 추후 ICS의 UID로 씁니다.
- 소스가 실패하면 다음 우선순위 소스로 넘어가고, 모든 시도는 `sync_run`에 기록됩니다.

## 다국어

10개 언어(한국어·영어·중국어 간체·일본어·스페인어·프랑스어·독일어·포르투갈어·러시아어·아랍어)를 지원합니다.
언어는 직접 고른 값(쿠키) → 브라우저 언어 → 영어 순으로 정하고, 아랍어는 오른쪽→왼쪽으로 배치합니다.
화면 문구는 `src/i18n/messages/<언어>.ts`, 대회·종목 이름은 `data/seed/names-i18n.json`, 팀은 한국어 외 언어에서 영문명을 씁니다.
수집기는 라운드·대진 미정·F1 세션을 `@md:9`, `@series:ws|@game:5`, `@f1:United States Grand Prix:race` 같은
언어 중립 토큰으로 저장하고 화면에서 `src/i18n/format.ts` 로 그 언어로 바꿉니다. (번역은 기계 번역 수준이라 원어민 검수를 권장)

## 로그인 (이메일 인증코드)

로그인하면 고른 팀·언어가 계정에 저장돼 어느 기기에서나 같은 팀이 보입니다. 비밀번호 없이 메일로 받은 6자리 코드로 로그인합니다.
코드·세션 토큰은 해시로만 저장하고, 이메일당 1분 간격·시간당 5회, IP 당 시간당 10회로 발송을 제한합니다.
운영에서는 `AUTH_SECRET`·`RESEND_API_KEY`·`MAIL_FROM` 이 모두 있어야 로그인 버튼이 보입니다 (설정법: [docs/DEPLOY.md](docs/DEPLOY.md) 5번).
계정 메뉴에서 계정과 저장 정보를 삭제할 수 있고, `/privacy` 에 개인정보 처리 안내가 있습니다.

## 수집 대회

| 대회 | 주 소스 | 대체 소스 |
|---|---|---|
| 프리미어리그, 라리가, 분데스리가, 세리에 A, 리그 1, UEFA 챔피언스리그 | football-data.org | ESPN |
| UEFA 유로파리그·컨퍼런스리그, FA컵, 카라바오컵, 코파 델 레이, DFB 포칼, 코파 이탈리아, 쿠프 드 프랑스 | ESPN | (없음: API-Football 무료 플랜은 2022~2024 시즌만 제공) |
| F1 (결승·예선·스프린트) | Jolpica F1 | OpenF1 |
| MLB | MLB Stats API | ESPN |
| NHL | NHL 공개 API | ESPN |
| NBA, NFL | ESPN | (없음: NBA 공식 CDN은 서버 접근 차단, balldontlie는 키 필요) |
| LCK, LoL 퍼스트 스탠드, MSI, 월드 챔피언십 | LoL Esports 비공식 API (사이트 공개 키) | (없음: PandaScore는 키 필요) |
| KBO 리그 (정규시즌·포스트시즌) | KBO 공식 홈페이지 일정 화면 데이터 | (없음) |
| KBL | 관리자 수동 입력 (CSV·화면) | — |

대회·팀 추가는 `data/seed/*.json`(파일명 순서대로 합쳐짐)에 항목을 넣고 `npm run db:setup`을 실행하면 됩니다.
F1은 팀 대신 시리즈 하나(`f1` 팀)를 선택하고, 세션은 제목(`match.title`)이 있는 이벤트로 저장됩니다.
ESPN의 미국 리그 팀 ID는 종목끼리 겹치므로 `nba:1`처럼 리그를 붙여 저장합니다.
LoL Esports 일정에는 팀 ID가 없어 팀 약칭(`T1`, `GEN`)을 소스 팀 ID로 씁니다. 국제대회의 해외 팀은 자동 생성됩니다.
KBO는 공식 경기 ID(`20261025HTSS0`)를 그대로 쓰고, 우천취소 경기는 원래 날짜에 &lsquo;연기&rsquo;로 남습니다
(KBO가 재편성 경기를 새 경기로 발표하므로 그 경기는 새 ID로 추가됩니다). 포스트시즌에서 시리즈가 먼저 끝나면 열리지 않는
경기(예: 5전 3선승의 4·5차전)는 지금까지의 승패로 계산해 &lsquo;진출 시&rsquo;로 표시합니다.
국내 컵대회는 `soccer/eng.fa|eng.1`처럼 팀 목록을 가져올 리그를 함께 적어, 우리 리그 팀의 컵 일정만 받습니다.
컵대회는 우리 팀이 아직 합류하지 않으면(추첨 전) 0건이 정상이라 실패로 보지 않습니다.
시드에 없는 상대팀이 주 소스에 나오면 원문 이름으로 자동 생성되고(`team.needs_review = true`), 팀 선택 목록에는 나오지 않습니다.

## 로컬 실행

```bash
npm install
cp .env.example .env.local     # 필요하면 FOOTBALL_DATA_API_KEY 입력
npm run db:local               # 터미널 1: 로컬 Postgres(PGlite) 서버, 데이터는 .data/
npm run db:setup               # 터미널 2: 스키마 + 시드(data/seed/catalog.json)
npm run sync -- --force        # 일정 수집
npm run dev                    # http://localhost:3000
```

`npm test`는 메모리 DB로 수집기(ID 유지, 대체 소스 전환, 갱신 주기)와 CSV 가져오기를 검증합니다.

## KBL 관리자 (`/admin`)

환경변수 `ADMIN_PASSWORD`를 설정하면 켜집니다(비워 두면 꺼짐). 로그인은 7일 유지되고, 비밀번호를 바꾸면 모든 로그인이 풀립니다.

- **CSV 올리기**: 시즌 전체 일정을 한 번에 올립니다. 예시는 `public/samples/kbl_sample.csv`
  (사이트의 `/samples/kbl_sample.csv`에서도 받을 수 있음). KBO는 자동 수집이라 여기서 다루지 않습니다. 엑셀에서 &lsquo;CSV UTF-8&rsquo; 또는 기본 CSV(CP949)로 저장해도 됩니다.
  - 열: `game_key, league, date, time, home, away, status, round, home_placeholder, away_placeholder, venue`
  - 시각은 **한국 시간**. 시간을 비우면 시간 미정. 상태: 확정·미정·진출시·추첨대기·연기·취소
  - **같은 `game_key`로 다시 올리면 같은 경기(같은 고유 ID)를 고칩니다.** 파일에 없는 기존 경기는 지우지 않습니다.
  - 한 줄이라도 오류가 있으면 아무것도 저장하지 않고, 줄 번호와 이유를 보여줍니다.
- **경기 수정**: 리그·월별 목록 → 경기 단위로 날짜·시간·상태·팀·장소 수정(우천 순연 등), 추가, 삭제.
  일정이 바뀌면 `sequence`가 올라갑니다(추후 ICS 변경 알림용).
- **포스트시즌 &lsquo;진출 시&rsquo; 경기**: 확정 팀(예: 정규시즌 1위)은 상대를 비우고 &lsquo;플레이오프 승자&rsquo;처럼 표시 문구를 쓴 경기 하나,
  진출 후보 팀은 각자 상태 &lsquo;진출 시&rsquo;인 경기를 하나씩 만듭니다. 결과가 나오면 확정 팀 경기의 상대를 채우고 후보 경기는 삭제합니다.
- **팀 이름**: 컵대회·유럽대항전에서 자동 생성된 영어 이름 팀에 한국어 이름을 붙입니다.
- **현황**: 대회별 경기 수·마지막 업데이트와 최근 수집 실패를 봅니다.

## 구조

| 경로 | 내용 |
|---|---|
| `db/migrations/` | SQL 마이그레이션 (`npm run db:setup`이 순서대로 적용) |
| `data/seed/catalog.json` | 종목·대회·팀(한국어명)과 소스별 팀 ID |
| `src/collector/sources/` | 소스별 수집기 (응답 → 공통 `SourceMatch`) |
| `src/collector/upsert.ts` | 팀 매핑, 같은 경기 찾기, ID를 유지하는 저장 |
| `src/collector/run.ts` | 갱신 주기 판단, 대체 소스 전환, 실행 기록 |
| `src/lib/schedule.ts` | 사이트가 DB를 읽는 쿼리 |
| `src/components/` | 팀 선택, 월간 달력, 다가오는 경기, D-day |
| `src/lib/manual/` | KBO·KBL CSV 읽기·검증·저장, 관리자 화면용 조회·수정 |
| `src/app/admin/` | 관리자 화면 (로그인, CSV, 경기 수정, 팀 이름) |

### 팀 이름 통일

팀은 `team`(우리 기준, 한국어명)과 `team_source_ref`(소스의 팀 ID → 우리 팀)로 나눕니다. 처음 보는 소스 팀은
영문명·별칭을 정규화해 **정확히 한 팀과 일치할 때만** 자동 연결하고, 그렇지 않으면 `unmapped_team`에 남기고 그 경기는 저장하지 않습니다.

### 갱신 주기

Actions는 매시간 돕니다. 대회별로 마지막 전체 수집 후 11시간 30분이 지났으면 **시즌 전체**를 받고,
그 사이 `±18시간 안에 경기가 있거나 competition.postseason = true`이면 매시간 **최근 며칠 일정만** 받습니다
(수집기의 `fetchRecent`, 없으면 전체). 요청 제한이 있는 무료 API를 아끼기 위한 구조입니다.

## 배포 (무료)

자세한 단계는 [docs/DEPLOY.md](docs/DEPLOY.md)를 보세요. 요약:

1. **Supabase**(서울 리전)에서 프로젝트를 만들고 Connection string(Transaction pooler, 포트 6543)을 복사합니다.
2. **GitHub** 저장소 Settings → Secrets에 `DATABASE_URL`과 `FOOTBALL_DATA_API_KEY`를 넣습니다.
   Actions 탭에서 `sync-schedules`를 `force`로 한 번 실행합니다 (DB 표 생성 + 첫 수집).
3. **Vercel**에서 저장소를 가져오고 환경변수 `DATABASE_URL`과 `ADMIN_PASSWORD`(길고 무작위로)를 넣습니다.
   서버 리전은 `vercel.json`에서 서울(`icn1`)로 맞춰 두었습니다.

## 데이터 출처

- Football data provided by the Football-Data.org API (표기 의무)
- Jolpica F1 API (데이터 라이선스 CC BY-NC-SA 4.0), OpenF1
- MLB Stats API (© MLB Advanced Media, 개인·비상업 이용), NHL 공개 API
- ESPN (비공식 엔드포인트)
- LoL Esports (Riot Games, 비공식 엔드포인트)
- KBO 공식 홈페이지 (일정 화면 데이터, 비공식 이용)
