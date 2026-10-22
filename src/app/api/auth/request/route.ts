import { NextResponse } from "next/server";
import { isLocale } from "@/i18n/config";
import { hitRateLimit, issueCode, normalizeEmail } from "@/lib/auth/core";
import { bad, readJson } from "@/lib/auth/http";
import { loginEnabled, sendLoginCode } from "@/lib/auth/mailer";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import { getDb } from "@/lib/db";

// POST /api/auth/request {email, locale, turnstile} → 6자리 코드를 메일로 보낸다 (turnstile: 사람 확인 토큰)
export async function POST(req: Request) {
  if (!loginEnabled()) return bad("login_disabled", 503);
  const body = await readJson(req);
  if (!body) return bad("bad_request");
  const email = normalizeEmail(body.email);
  if (!email) return bad("invalid_email");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await verifyTurnstile(body.turnstile, ip === "unknown" ? null : ip))) return bad("captcha", 400);
  const db = getDb();
  // 아무 주소로나 메일을 보내게 하는 남용을 막기 위해 IP 당 시간당 10회로 제한
  if (!(await hitRateLimit(db, `code-ip:${ip}`, 10, 3600))) return bad("too_many", 429);
  const r = await issueCode(db, email);
  if (!r.ok) return bad(r.reason === "wait" ? "wait" : "too_many", 429);
  try {
    await sendLoginCode(email, r.code, isLocale(body.locale) ? body.locale : "en");
  } catch (err) {
    console.error(err);
    return bad("send_failed", 502);
  }
  return NextResponse.json({ ok: true });
}
