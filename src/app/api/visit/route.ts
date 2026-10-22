import { NextResponse } from "next/server";
import { hitRateLimit } from "@/lib/auth/core";
import { bad, readJson } from "@/lib/auth/http";
import { getDb } from "@/lib/db";
import { getStats, isVisitorId, recordVisit } from "@/lib/visitors";

// 화면은 탭 하나당 1분에 한 번 부른다. 같은 IP(회사·학교 등 여러 명 포함)에서 10분에 120번을 넘으면
// 숫자 부풀리기로 보고 기록하지 않는다 (숫자만 돌려준다).
const IP_LIMIT = 120;
const IP_WINDOW_SEC = 600;

// POST /api/visit {id} → 방문 신호를 남기고 {online, today, total} 을 돌려준다 (화면이 1분마다 부른다)
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body || !isVisitorId(body.id)) return bad("bad_request");
  const db = getDb();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const allowed = await hitRateLimit(db, `visit-ip:${ip}`, IP_LIMIT, IP_WINDOW_SEC);
  const stats = allowed ? await recordVisit(db, body.id) : await getStats(db);
  return NextResponse.json(stats, { headers: { "Cache-Control": "private, no-store" } });
}
