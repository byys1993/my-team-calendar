import { NextResponse } from "next/server";
import { normalizeEmail, verifyCode } from "@/lib/auth/core";
import { bad, publicUser, readJson, setSessionCookie } from "@/lib/auth/http";
import { getDb } from "@/lib/db";

// POST /api/auth/verify {email, code} → 맞으면 로그인 쿠키를 주고 계정 정보를 돌려준다
export async function POST(req: Request) {
  const body = await readJson(req);
  const email = normalizeEmail(body?.email);
  if (!body || !email || typeof body.code !== "string") return bad("bad_request");
  const r = await verifyCode(getDb(), email, body.code.trim());
  if (!r.ok) return bad(r.reason === "limit" ? "too_many" : "invalid_code", r.reason === "limit" ? 429 : 400);
  const res = NextResponse.json({ user: publicUser(r.user) });
  setSessionCookie(res, r.token, r.expires);
  return res;
}
