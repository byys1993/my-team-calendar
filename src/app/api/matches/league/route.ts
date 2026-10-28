import { NextResponse } from "next/server";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";
import { getDb } from "@/lib/db";
import { getCompetitionMonth, isValidTz } from "@/lib/schedule";

// GET /api/matches/league?comp=epl&month=2026-10&tz=Asia/Seoul&lang=ko
// 리그 일정 탭: 그 시간대 기준 한 달의 대회 경기 전체
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const comp = params.get("comp") ?? "";
  const month = params.get("month") ?? "";
  const tz = params.get("tz") ?? "UTC";
  const lang = params.get("lang");
  if (!/^[a-z0-9-]{1,64}$/.test(comp) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !isValidTz(tz)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const matches = await getCompetitionMonth(getDb(), comp, month, tz, isLocale(lang) ? lang : DEFAULT_LOCALE);
  return NextResponse.json(
    { matches },
    // CDN에서만 5분 캐시 (/api/matches 와 같다)
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" } },
  );
}
