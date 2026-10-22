import { NextResponse } from "next/server";
import { endSession } from "@/lib/auth/core";
import { clearSessionCookie, readJson, sessionToken } from "@/lib/auth/http";
import { getDb } from "@/lib/db";

// POST /api/auth/logout
export async function POST(req: Request) {
  if (!(await readJson(req))) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const token = await sessionToken();
  if (token) await endSession(getDb(), token);
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}
