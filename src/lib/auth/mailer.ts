import type { Locale } from "@/i18n/config";
import { fmt, MESSAGES } from "@/i18n";

// 로그인 기능을 켤 수 있는지: 운영에서는 메일 발송·서명 설정이 모두 있어야 하고, 개발 중에는 항상 켠다.
export function loginEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM && process.env.AUTH_SECRET);
}

// 로그인 코드 메일. Resend(https://resend.com) API 로 보낸다.
// RESEND_API_KEY·MAIL_FROM 이 없으면 개발 중에는 콘솔에 코드를 찍고, 운영에서는 오류를 낸다.
export async function sendLoginCode(email: string, code: string, locale: Locale): Promise<void> {
  const { auth } = MESSAGES[locale];
  const subject = fmt(auth.emailSubject, { code });
  const text = fmt(auth.emailBody, { code });
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) {
    if (process.env.NODE_ENV === "production") throw new Error("메일 발송 설정(RESEND_API_KEY, MAIL_FROM)이 없습니다.");
    console.log(`[dev] 로그인 코드 ${email}: ${code}`);
    return;
  }
  const html = `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.6">
<p>${escapeHtml(text)}</p>
<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>
</div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [email], subject, text, html }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`메일 발송 실패: ${res.status} ${await res.text()}`);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
