import { NextResponse } from "next/server";
import { sendNotifyEmails } from "@/lib/auth/mailer";
import { cleanupExpired } from "@/lib/cleanup";
import { checkHealth, pickAlerts, sendAdminMail, sendAlertMail } from "@/lib/health";
import { buildWeeklyReport, markWeeklyReportSent, weeklyReportDue } from "@/lib/report";
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
  // 데이터 이상 점검 → 새 문제만 운영자에게 메일 (실패해도 알림 발송 결과에는 영향 없음)
  let health: { issues: number; alerted: number; error?: string } = { issues: 0, alerted: 0 };
  try {
    const issues = await checkHealth(db);
    const due = await pickAlerts(db, issues);
    if (due.length) await sendAlertMail(due, siteUrl);
    health = { issues: issues.length, alerted: due.length };
  } catch (err) {
    health.error = err instanceof Error ? err.message : String(err);
  }
  // 매주 월요일 오전 9시(한국 시간) 이후 첫 호출에서 운영 리포트 메일
  let report = false;
  try {
    if (await weeklyReportDue(db)) {
      const { subject, text } = await buildWeeklyReport(db, siteUrl);
      await sendAdminMail(subject, text);
      await markWeeklyReportSent(db);
      report = true;
    }
  } catch (err) {
    console.error(err);
  }
  return NextResponse.json({ ...result, cleaned, health, report });
}
