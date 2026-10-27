import { NextResponse } from "next/server";
import { hitRateLimit } from "@/lib/auth/core";
import { bad, readJson } from "@/lib/auth/http";
import { getDb } from "@/lib/db";
import { isEventName, recordEvent } from "@/lib/events";
import { isVisitorId } from "@/lib/visitors";

// POST /api/event {id, name} → 핵심 행동 한 번 기록 (같은 사람·같은 날·같은 행동은 한 번만 센다)
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body || !isVisitorId(body.id) || !isEventName(body.name)) return bad("bad_request");
  const db = getDb();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (await hitRateLimit(db, `event-ip:${ip}`, 300, 600)) await recordEvent(db, body.id, body.name);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
