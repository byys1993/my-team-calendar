import { isLocale, type Locale } from "@/i18n/config";
import { getDb } from "@/lib/db";
import { buildIcs, parseTeamList } from "@/lib/ics";
import { recordIcsFetch } from "@/lib/icsStats";
import { getCatalog, getMatchesForTeams } from "@/lib/schedule";

// GET /ics/<팀 slug,팀 slug>.ics?lang=ko → 그 팀들의 경기 캘린더 (캘린더 앱 구독용)
// 로그인 없이 쓰는 주소라 팀 목록이 곧 주소다. CDN 에 30분 캐시해 캘린더 앱이 자주 불러도 DB 부담이 적다.
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const file = decodeURIComponent((await params).file);
  const slugs = file.endsWith(".ics") ? parseTeamList(file.slice(0, -4)) : null;
  if (!slugs) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang");
  const locale: Locale = isLocale(lang) ? lang : "ko";
  const db = getDb();
  const [matches, catalog] = await Promise.all([getMatchesForTeams(db, slugs, locale), getCatalog(db, locale)]);
  // 구독 규모 세기 (실패해도 캘린더는 내려준다)
  await recordIcsFetch(db, slugs, locale).catch(() => {});
  const body = buildIcs({ matches, catalog, locale, siteUrl: process.env.SITE_URL ?? url.origin });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="my-team-calendar.ics"',
      "Cache-Control": "public, max-age=0, s-maxage=1800, stale-while-revalidate=3600",
    },
  });
}
