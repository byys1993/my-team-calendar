import { NextResponse } from "next/server";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";
import { getDb } from "@/lib/db";
import { getCompetitionsDay, MAX_TEAMS } from "@/lib/schedule";

const validTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// GET /api/matches/day?comps=epl,ucl&date=2026-10-25&tz=Asia/Seoul&lang=ko
// 날짜 패널의 '같은 리그 다른 경기' (펼칠 때만 부른다). 그 시간대 기준 그날의 대회 경기 전체
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const comps = [
    ...new Set(
      (params.get("comps") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^[a-z0-9-]{1,64}$/.test(s)),
    ),
  ];
  const date = params.get("date") ?? "";
  const tz = params.get("tz") ?? "UTC";
  const lang = params.get("lang");
  if (comps.length > MAX_TEAMS || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || !validTz(tz)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const matches = await getCompetitionsDay(getDb(), comps, date, tz, isLocale(lang) ? lang : DEFAULT_LOCALE);
  return NextResponse.json(
    { matches },
    // CDN에서만 5분 캐시 (/api/matches 와 같다)
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" } },
  );
}
