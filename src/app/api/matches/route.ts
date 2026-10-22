import { NextResponse } from "next/server";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";
import { getDb } from "@/lib/db";
import { getMatchesForTeams, MAX_TEAMS } from "@/lib/schedule";

// GET /api/matches?teams=arsenal,man-city&lang=ko
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const slugs = [
    ...new Set((params.get("teams") ?? "").split(",").map((s) => s.trim()).filter((s) => /^[a-z0-9-]+$/.test(s))),
  ];
  const lang = params.get("lang");
  if (slugs.length > MAX_TEAMS) {
    return NextResponse.json({ error: `max ${MAX_TEAMS} teams` }, { status: 400 });
  }
  const matches = await getMatchesForTeams(getDb(), slugs, isLocale(lang) ? lang : DEFAULT_LOCALE);
  return NextResponse.json(
    { matches },
    // CDN에서만 5분 캐시 (수집 주기보다 충분히 짧다). 브라우저는 매번 확인한다.
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" } },
  );
}
