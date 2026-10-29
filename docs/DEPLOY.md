# 배포 안내 (무료)

사이트는 **Vercel**, DB는 **Supabase**, 정기 수집은 **GitHub Actions**에서 돌아갑니다. 셋 다 무료 플랜으로 충분합니다.
순서가 중요합니다: **DB → 코드 올리기 → 첫 수집(표 만들기) → 사이트 배포**. 사이트를 만들 때 DB에 표가 있어야 빌드가 성공합니다.

> 계정 만들기, 비밀번호·키 입력은 직접 해 주세요. 비밀번호와 키는 채팅에 붙여 넣지 않아도 됩니다.

## 1. GitHub 계정과 빈 저장소

1. https://github.com/signup 에서 가입합니다.
2. 오른쪽 위 **+ → New repository**를 누릅니다.
   - Repository name: `my-team-calendar`
   - **Private** 선택
   - README, .gitignore, license는 **모두 체크하지 않음** (빈 저장소)
3. **Create repository**를 누른 뒤, 화면의 주소(`https://github.com/<아이디>/my-team-calendar.git`)를 Claude에게 알려주세요.
   Claude가 코드를 올리고, 그때 GitHub 로그인 창이 뜨면 로그인해 주세요.

## 2. Supabase 프로젝트 (DB)

1. https://supabase.com 에서 **Start your project → Continue with GitHub**로 가입합니다.
2. **New project**를 누릅니다.
   - Name: `my-team-calendar`
   - Database Password: **Generate a password**를 누른 뒤, 비밀번호를 안전한 곳에 적어 둡니다
     (영문·숫자만 있는 비밀번호가 편합니다. 특수문자가 있으면 아래 주소에 넣을 때 깨질 수 있어요)
   - Region: **Northeast Asia (Seoul)**
   - Plan: Free
3. 프로젝트가 만들어지면 위쪽 **Connect** 버튼을 누릅니다.
   **Transaction pooler** 항목의 주소를 복사합니다. 모양은 대략 이렇습니다.
   ```
   postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres
   ```
4. `[YOUR-PASSWORD]` 부분을 2단계에서 적어 둔 비밀번호로 바꿉니다. 이것이 **DATABASE_URL**입니다.

## 3. GitHub 비밀값 넣기와 첫 수집

1. GitHub 저장소 → **Settings → Secrets and variables → Actions → New repository secret**에서 두 개를 만듭니다.
   | Name | Secret |
   |---|---|
   | `DATABASE_URL` | 2단계에서 만든 주소 |
   | `FOOTBALL_DATA_API_KEY` | football-data.org 키 (`.env.local`에 있는 값) |
2. 저장소의 **Actions** 탭으로 갑니다. 워크플로를 켤지 물으면 켭니다.
3. 왼쪽 **sync-schedules → Run workflow**를 누르고 **force**에 체크한 뒤 실행합니다.
   3~5분 뒤 초록색 체크가 뜨면 DB에 표와 모든 일정이 들어간 것입니다.
   이후에는 매시간 자동으로 돕니다.

## 4. Vercel 배포 (사이트)

1. https://vercel.com/signup 에서 **Hobby**를 고르고 **Continue with GitHub**로 가입합니다.
2. **Add New… → Project**에서 `my-team-calendar` 저장소를 **Import**합니다.
   저장소가 안 보이면 **Adjust GitHub App Permissions**에서 이 저장소 접근을 허용합니다.
3. **Environment Variables**에 두 개를 넣습니다.
   | Key | Value |
   |---|---|
   | `DATABASE_URL` | 2단계에서 만든 주소 (GitHub에 넣은 것과 같음) |
   | `ADMIN_PASSWORD` | 관리자 페이지 비밀번호. **새로** 길고 무작위로 만들어 주세요 (로컬용과 다르게) |
4. **Deploy**를 누릅니다. 1~2분 뒤 `https://my-team-calendar-xxxx.vercel.app` 주소가 생깁니다.
   이 주소를 Claude에게 알려주면 확인합니다.

## 그 뒤

- **코드를 고치면**: GitHub에 올리기만 하면 Vercel이 자동으로 다시 배포합니다.
- **미리보기 배포는 끔**: 비밀값이 Production 전용이라 다른 브랜치의 미리보기는 DB 주소가 없어 늘 실패합니다. 그래서 `vercel.json` 의 `git.deploymentEnabled` 로 작업 브랜치(`claude/**`·`codex/**`)는 배포하지 않습니다.
- **일정 수집**: GitHub Actions가 매시간 돌고, 실패 기록은 사이트의 `/admin` 현황에서 볼 수 있습니다.
- **KBL 일정**: `/admin` → CSV 올리기 (비밀번호는 Vercel에 넣은 `ADMIN_PASSWORD`).
- **Supabase 무료 플랜**은 7일 동안 접속이 없으면 잠시 멈추는데, 매시간 수집이 돌아서 멈추지 않습니다.
- **비용**: 모두 무료 한도 안입니다. 비공개 저장소의 Actions는 월 2,000분 무료이고, 예상 사용량은 월 1,000분 안팎입니다.
- **주소 바꾸기(선택)**: Vercel 프로젝트 → Settings → Domains에서 원하는 도메인을 연결할 수 있습니다 (도메인 비용 별도).

## 5. 이메일 로그인 켜기 (선택)

로그인 없이도 사이트의 모든 기능을 쓸 수 있고, 아래 설정을 마치면 헤더에 **로그인** 버튼이 나타납니다.
로그인 코드 메일을 보내려면 **내 도메인**이 필요합니다 (무료 메일 발송 서비스는 내 도메인 없이는 본인 주소로만 보낼 수 있음).

1. **도메인 구입**: 가비아·Cloudflare·Namecheap 등에서 원하는 도메인을 삽니다 (연 1~2만 원).
2. **Resend 가입**: https://resend.com → Domains → Add Domain → 내 도메인 입력(예: `mail.내도메인.com`).
   화면에 나오는 DNS 레코드(TXT·MX 등)를 도메인 구입처의 DNS 설정에 그대로 추가하고, Resend 에서 Verified 가 될 때까지 기다립니다.
3. **API 키**: Resend → API Keys → Create (권한: Sending access).
4. **Vercel 환경 변수** 세 개를 추가하고 Redeploy 합니다.
   | Key | Value |
   |---|---|
   | `AUTH_SECRET` | 32자 이상 무작위 문자열 |
   | `RESEND_API_KEY` | 3단계의 키 (`re_` 로 시작) |
   | `MAIL_FROM` | `마이팀 캘린더 <login@mail.내도메인.com>` 처럼 2단계에서 인증한 도메인의 주소 |
5. 사이트에서 로그인 → 메일로 온 6자리 코드 입력으로 확인합니다.

무료 한도: Resend 무료 플랜은 하루 100통·월 3,000통입니다. 같은 이메일은 1분에 한 번, 시간당 5번, 같은 IP 는 시간당 10번까지만 코드를 보냅니다.

## 6. 경기 알림 메일 켜기 (선택, 5번 이후)

로그인한 사람이 계정 메뉴에서 **경기 있는 날 아침** 또는 **매주 월요일**에 내 팀 일정을 메일로 받을 수 있습니다.
GitHub Actions 의 매시간 수집이 끝나면 사이트의 `/api/cron/notify` 를 불러, 각자의 시간대로 정한 시각이 지난 사람에게 보냅니다.

1. 무작위 문자열을 하나 만듭니다 (`AUTH_SECRET` 만들 때와 같은 방법).
2. **Vercel** → Settings → Environment Variables → `CRON_SECRET` 에 그 값을 넣고 Redeploy 합니다.
3. **GitHub** 저장소 → Settings → Secrets and variables → Actions → New repository secret → `CRON_SECRET` 에 같은 값을 넣습니다.
4. 다음 정시 수집(Actions 의 sync-schedules) 로그 마지막 단계 `send match alert emails` 에 `{"checked":..,"sent":..}` 가 찍히면 됩니다.

`CRON_SECRET` 이 없으면 발송 단계는 건너뜁니다. 한 번 실행에 최대 80통만 보내고 나머지는 다음 시간에 보냅니다
(Resend 무료 한도 하루 100통에 로그인 코드 메일 몫을 남겨 둠). 받는 사람이 늘면 Resend 유료 플랜이 필요합니다.

## 7. 로그인 사람 확인 켜기 (Cloudflare Turnstile, 선택)

로그인 코드 요청을 자동화로 남용해 메일 한도를 소진시키는 공격을 막습니다. 대부분은 자동 통과하고 의심스러울 때만 체크를 요구합니다.

1. https://dash.cloudflare.com 가입 → 왼쪽 **Turnstile** → **Add widget**
2. Widget name: `my-team-calendar`, Hostname: `my-team-calendar.com` (www 포함 자동), Widget Mode: **Managed** → Create
3. 나오는 **Site Key**·**Secret Key** 를 Vercel 환경 변수 `TURNSTILE_SITE_KEY`·`TURNSTILE_SECRET_KEY` 에 넣고 Redeploy 합니다.
   (둘 다 있을 때만 켜집니다. `*.vercel.app` 주소에서도 로그인하려면 위젯 Hostname 에 그 주소도 추가합니다.)

## 참고: Supabase 공개 API 차단 (RLS)

Supabase 는 public 테이블을 공개 API(anon 키)로 노출합니다. 이 사이트는 그 API 를 쓰지 않으므로 모든 테이블에 RLS 를 켜 두었습니다
(`db/migrations/010_enable_rls.sql`, 정책 없음 = 공개 API 로는 읽기·쓰기 불가, 서버 접속 계정은 테이블 주인이라 영향 없음).
새 테이블을 추가하면 같은 마이그레이션 줄을 넣어야 하며, `tests/rls.test.ts` 가 빠진 것을 잡아냅니다.

## 8. 정시 작업을 Cloudflare Workers 로 (알림 메일 · 일정 수집)

GitHub Actions 예약 실행은 무료 플랜에서 정시 실행을 보장하지 않아 몇 시간씩 밀리기도 합니다.
Cloudflare Workers 의 Cron Triggers(무료)로 정시에 부르면 알림 메일은 정한 시각 10분 안에, 일정 수집은 매시 7분에 시작합니다.

1. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Start with Hello World!** → 이름 `my-team-calendar-cron` → **Deploy**
2. **Edit code** → 내용을 `cloudflare/notify-cron.js` 로 바꾸고 **Deploy**
3. **Settings → Variables and Secrets** 에 Secret 두 개
   - `CRON_SECRET`: Vercel 과 같은 값
   - `GITHUB_TOKEN`: GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate
     (Repository access: Only select → `my-team-calendar`, Permissions: **Actions → Read and write**, 만료 1년)
4. **Settings → Trigger events → Cron Triggers** 에 두 개: `*/10 * * * *`, `7 * * * *`
5. Worker **Logs** 에 `notify 200`(10분마다), `sync 204`(매시 7분)가 찍히면 됩니다.
   GitHub 토큰은 만료일 전에 새로 만들어 바꿔 넣어야 합니다.
