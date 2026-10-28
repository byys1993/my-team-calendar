import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getBoxScore } from "@/lib/boxscoreStore";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/boxscore?match=<경기 ID> → {box} (끝난 미국 4대 리그 경기만). 처음 열 때 출처에서 받아 저장한다.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("match") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  try {
    const box = await getBoxScore(getDb(), id);
    if (!box) return NextResponse.json({ error: "not_found" }, { status: 404 });
    // CDN에서 10분 캐시 (경기 직후 기록 수정도 금방 반영되게)
    return NextResponse.json({ box }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=600, stale-while-revalidate=3600" } });
  } catch (err) {
    console.error("[boxscore]", id, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
