# 마이팀 캘린더

응원하는 팀을 고르면 그 팀의 리그·컵·국제대회 일정을 사이트 안 캘린더에 모아 보여주는 비상업 개인 프로젝트입니다.

- 사이트(Next.js)는 **DB만 읽습니다**. 외부 API는 정기 수집 작업(`npm run sync`, GitHub Actions)만 호출합니다.
- 경기마다 바뀌지 않는 UUID(`match.id`)를 부여합니다. 일정이 바뀌어도 같은 ID를 유지하며, 추후 ICS의 UID로 씁니다.
- 소스가 실패하면 다음 우선순위 소스로 넘어가고, 모든 시도는 `sync_run`에 기록됩니다.

## 로컬 실행

```bash
npm install
cp .env.example .env.local     # 필요하면 FOOTBALL_DATA_API_KEY 입력
npm run db:local               # 터미널 1: 로컬 Postgres(PGlite) 서버, 데이터는 .data/
npm run db:setup               # 터미널 2: 스키마 + 시드(data/seed/catalog.json)
npm run sync -- --force        # 일정 수집
npm run dev                    # http://localhost:3000
```

`npm test`는 메모리 DB로 수집기(ID 유지, 대체 소스 전환, 갱신 주기)를 검증합니다.

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

### 팀 이름 통일

팀은 `team`(우리 기준, 한국어명)과 `team_source_ref`(소스의 팀 ID → 우리 팀)로 나눕니다. 처음 보는 소스 팀은
영문명·별칭을 정규화해 **정확히 한 팀과 일치할 때만** 자동 연결하고, 그렇지 않으면 `unmapped_team`에 남기고 그 경기는 저장하지 않습니다.

### 갱신 주기

Actions는 매시간 돌고, 대회별로 `±18시간 안에 경기가 있거나 competition.postseason = true`이면 매시간,
아니면 마지막 시도 후 11시간 30분이 지났을 때만 수집합니다.

## 배포 (무료)

1. **Supabase**에서 프로젝트를 만들고 Connection string(Transaction pooler, 포트 6543)을 복사합니다.
2. **GitHub** 저장소 Settings → Secrets에 `DATABASE_URL`과 `FOOTBALL_DATA_API_KEY`를 넣습니다.
   Actions 탭에서 `sync-schedules`를 `force`로 한 번 실행합니다.
3. **Vercel**에서 저장소를 가져오고 환경변수 `DATABASE_URL`을 넣습니다.

## 데이터 출처

- Football data provided by the Football-Data.org API (표기 의무)
- ESPN (비공식 엔드포인트, 대체 소스)
