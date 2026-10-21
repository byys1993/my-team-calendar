import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMatchesForTeams, MAX_TEAMS } from "@/lib/schedule";

// GET /api/matches?teams=arsenal,man-city
export async function GET(req: Request) {
  const param = new URL(req.url).searchParams.get("teams") ?? "";
  const slugs = [...new Set(param.split(",").map((s) => s.trim()).filter((s) => /^[a-z0-9-]+$/.test(s)))];
  if (slugs.length > MAX_TEAMS) {
    return NextResponse.json({ error: `팀은 최대 ${MAX_TEAMS}개까지 선택할 수 있습니다.` }, { status: 400 });
  }
  const matches = await getMatchesForTeams(getDb(), slugs);
  return NextResponse.json(
    { matches },
    // CDN에서만 5분 캐시 (수집 주기보다 충분히 짧다). 브라우저는 매번 확인한다.
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" } },
  );
}
