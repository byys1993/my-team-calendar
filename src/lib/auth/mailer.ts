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

// 경기 알림 메일 묶음 발송 (Resend 배치 API, 한 번에 100통까지). 수신 거부 헤더를 붙여 메일 앱의 '구독 취소' 버튼이 동작하게 한다.
export async function sendNotifyEmails(
  emails: { to: string; subject: string; text: string; html: string; unsubscribeUrl: string }[],
): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  // 알림 메일은 로그인 코드 주소(login@)가 아니라 같은 도메인의 alert@ 에서 보낸다 (NOTIFY_FROM 으로 따로 지정 가능)
  const from = process.env.NOTIFY_FROM ?? process.env.MAIL_FROM?.replace(/\blogin@/, "alert@");
  if (!key || !from) {
    if (process.env.NODE_ENV === "production") throw new Error("메일 발송 설정(RESEND_API_KEY, MAIL_FROM)이 없습니다.");
    for (const e of emails) console.log(`[dev] 알림 메일 ${e.to}: ${e.subject}\n${e.text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(
      emails.map((e) => ({
        from,
        to: [e.to],
        subject: e.subject,
        text: e.text,
        html: e.html,
        headers: {
          "List-Unsubscribe": `<${e.unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      })),
    ),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`알림 메일 발송 실패: ${res.status} ${await res.text()}`);
}
