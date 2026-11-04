import { getDb } from "@/lib/db";
import { getCatalog } from "@/lib/schedule";
import { SITE_URL } from "@/lib/site";

// /llms.txt: ChatGPT·Perplexity 같은 AI 검색이 사이트를 이해할 때 읽는 소개 문서 (llmstxt.org 형식, 마크다운).
// 리그·팀 목록은 DB 에서 만들고 CDN 에 하루 캐시한다.
export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  // 차례로 조회 (한 연결에 동시에 보내면 Supabase 풀러에서 멈춘다)
  const ko = await getCatalog(db, "ko");
  const en = await getCatalog(db, "en");
  const enNames = new Map(en.competitions.map((c) => [c.slug, c.name]));
  // '프리미어리그 (Premier League)' — 영어 이름이 같으면 한 번만
  const named = (c: { slug: string; name: string }) => {
    const e = enNames.get(c.slug);
    return e && e !== c.name ? `${c.name} (${e})` : c.name;
  };
  const sportName = new Map(ko.sports.map((s) => [s.slug, s.name]));
  const teamCount = new Map<string, number>();
  for (const t of ko.teams) if (t.competition) teamCount.set(t.competition, (teamCount.get(t.competition) ?? 0) + 1);

  const leagues = ko.competitions
    .filter((c) => teamCount.get(c.slug))
    .map((c) => `- [${named(c)}](${SITE_URL}/league/${c.slug}): ${sportName.get(c.sport) ?? c.sport}, ${teamCount.get(c.slug)}개 팀 일정·순위`);
  const cups = ko.competitions.filter((c) => !teamCount.get(c.slug)).map(named);

  const text = `# 마이팀 캘린더 (My Team Calendar)

> 응원하는 팀을 고르면 리그·컵대회·국제대회·e스포츠 경기 일정과 결과, 국내 중계 채널을 내 시간대의 캘린더 하나에 모아 보여 주는 무료 비상업 사이트입니다. A free, non-commercial site that collects fixtures, results and Korean TV listings for the teams you follow into one calendar in your time zone.

- 대상: KBO·K리그·KBL·V-리그·유럽 5대 리그·UEFA 대회·NBA·MLB·NFL·NHL·F1·LCK 등 ${ko.competitions.length}개 리그·대회, ${ko.teams.length}개 팀
- 일정은 공식 데이터에서 매시간 자동으로 갱신됩니다 (경기 당일은 매시간, 평소 하루 두 번)
- 회원가입 없이 쓸 수 있고, 팀 선택은 브라우저에 저장됩니다. 이메일 로그인은 알림 메일과 기기 간 동기화용입니다
- 지원 언어: 한국어, English, 中文, 日本語, Español, Français, Deutsch, Português, Русский, العربية
- 개인이 AI 도구의 도움으로 만들고 운영하는 사이트입니다. 중요한 경기는 공식 발표도 함께 확인하세요

## 할 수 있는 것

- 팀 선택(최대 10팀) → 월간 캘린더, 다음 경기 D-day, 경기 결과(스포일러 방지 가능), 국내 중계 채널, 새벽 경기 표시
- 결과 표시: 승·무·패와 점수, 승부차기('패 1:1 승부차기 3-5'), 연장·슛아웃, F1 포디움
- 리그 순위표와 개인 기록 TOP 5 ("순위" 탭)
- 캘린더 구독: 구글·애플 캘린더에 구독 주소(ICS)를 넣으면 일정이 바뀔 때 자동 반영됩니다. 주소 형식: ${SITE_URL}/ics/<팀ID>,<팀ID>.ics?lang=ko
- 경기 알림 메일: 원하는 시각에 앞으로 24시간(또는 7일) 동안의 내 팀 경기를 하루 한 통

## 주요 페이지

- [첫 화면 (팀 선택·캘린더)](${SITE_URL}/)
- [소개](${SITE_URL}/about)
- [개인정보 처리 안내](${SITE_URL}/privacy)
- [사이트맵 (모든 팀·리그 페이지)](${SITE_URL}/sitemap.xml)
- 팀 페이지: ${SITE_URL}/team/<팀ID> (예: ${SITE_URL}/team/arsenal) — 다가오는 경기, 최근 결과, 중계, 순위
- 특정 팀을 바로 추가한 첫 화면: ${SITE_URL}/?add=<팀ID>

## 리그별 일정·순위

${leagues.join("\n")}

## 컵대회·국제대회 (참가 팀의 경기가 함께 표시됨)

${cups.join(", ")}

## 데이터 출처

football-data.org, ESPN, Jolpica-F1, OpenF1, MLB Stats API, NHL API, LoL Esports, KBO·K리그·KBL·KOVO 공식 홈페이지. 국내 중계 정보는 각 리그 공식 데이터와 대회별 기본 중계사를 합친 것입니다.
`;
  return new Response(text, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=86400",
    },
  });
}
