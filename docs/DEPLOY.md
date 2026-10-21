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
- **일정 수집**: GitHub Actions가 매시간 돌고, 실패 기록은 사이트의 `/admin` 현황에서 볼 수 있습니다.
- **KBL 일정**: `/admin` → CSV 올리기 (비밀번호는 Vercel에 넣은 `ADMIN_PASSWORD`).
- **Supabase 무료 플랜**은 7일 동안 접속이 없으면 잠시 멈추는데, 매시간 수집이 돌아서 멈추지 않습니다.
- **비용**: 모두 무료 한도 안입니다. 비공개 저장소의 Actions는 월 2,000분 무료이고, 예상 사용량은 월 1,000분 안팎입니다.
- **주소 바꾸기(선택)**: Vercel 프로젝트 → Settings → Domains에서 원하는 도메인을 연결할 수 있습니다 (도메인 비용 별도).
