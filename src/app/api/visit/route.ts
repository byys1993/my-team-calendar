import { NextResponse } from "next/server";
import { bad, readJson } from "@/lib/auth/http";
import { getDb } from "@/lib/db";
import { isVisitorId, recordVisit } from "@/lib/visitors";

// POST /api/visit {id} → 방문 신호를 남기고 {online, today, total} 을 돌려준다 (화면이 1분마다 부른다)
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body || !isVisitorId(body.id)) return bad("bad_request");
  const stats = await recordVisit(getDb(), body.id);
  return NextResponse.json(stats, { headers: { "Cache-Control": "private, no-store" } });
}
