import { NextResponse } from "next/server";
import { hitRateLimit, normalizeEmail } from "@/lib/auth/core";
import { bad, readJson } from "@/lib/auth/http";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import { CONTACT_MAX, CONTACT_MIN, contactEnabled, sendContactMail } from "@/lib/contact";
import { getDb } from "@/lib/db";

// POST /api/contact {message, email?, turnstile, website} → 운영자에게 문의 메일을 보낸다.
// website 는 사람 눈에 안 보이는 칸(자동 입력 프로그램만 채움). 사람 확인 + IP 당 시간당 5번, 전체 하루 50번까지.
export async function POST(req: Request) {
  if (!contactEnabled()) return bad("disabled", 503);
  const body = await readJson(req);
  if (!body) return bad("bad_request");
  // 자동 입력 프로그램이면 보낸 척만 한다
  if (typeof body.website === "string" && body.website.trim()) return NextResponse.json({ ok: true });
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length < CONTACT_MIN || message.length > CONTACT_MAX) return bad("invalid_message");
  const rawEmail = typeof body.email === "string" ? body.email.trim() : "";
  const replyTo = rawEmail ? normalizeEmail(rawEmail) : null;
  if (rawEmail && !replyTo) return bad("invalid_email");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await verifyTurnstile(body.turnstile, ip === "unknown" ? null : ip))) return bad("captcha");
  const db = getDb();
  if (!(await hitRateLimit(db, `contact-ip:${ip}`, 5, 3600))) return bad("too_many", 429);
  if (!(await hitRateLimit(db, "contact-all", 50, 86_400))) return bad("too_many", 429);
  try {
    await sendContactMail({ message, replyTo, locale: typeof body.locale === "string" ? body.locale.slice(0, 5) : "?" });
  } catch (err) {
    console.error(err);
    return bad("send_failed", 502);
  }
  return NextResponse.json({ ok: true });
}
