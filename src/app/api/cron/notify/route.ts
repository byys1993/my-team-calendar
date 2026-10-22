import { NextResponse } from "next/server";
import { sendNotifyEmails } from "@/lib/auth/mailer";
import { cleanupExpired } from "@/lib/cleanup";
import { getDb } from "@/lib/db";
import { runNotifications } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/notify (Authorization: Bearer <CRON_SECRET>) → 지금 보낼 차례인 경기 알림 메일을 보낸다.
// GitHub Actions 의 매시간 수집 작업이 수집을 마친 뒤 부른다. 오래된 기록 정리도 함께 한다.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const siteUrl = process.env.SITE_URL ?? new URL(req.url).origin;
  const db = getDb();
  const result = await runNotifications(db, sendNotifyEmails, { siteUrl });
  const cleaned = await cleanupExpired(db);
  return NextResponse.json({ ...result, cleaned });
}
