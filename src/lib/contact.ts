// 문의·제안 양식. 받는 주소(CONTACT_EMAIL)는 화면에 내보내지 않고 서버에서만 쓴다 (주소 수집 스팸 방지).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function contactAddress(): string | null {
  const v = process.env.CONTACT_EMAIL?.trim();
  return v && EMAIL_RE.test(v) ? v : null;
}

// 양식을 보여 줄지: 받는 주소가 있고, 운영에서는 메일 발송 설정까지 있어야 한다
export function contactEnabled(): boolean {
  if (!contactAddress()) return false;
  if (process.env.NODE_ENV !== "production") return true;
  return !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export const CONTACT_MIN = 5;
export const CONTACT_MAX = 2000;

export async function sendContactMail(input: { message: string; replyTo: string | null; locale: string }): Promise<void> {
  const to = contactAddress();
  if (!to) throw new Error("CONTACT_EMAIL 없음");
  const key = process.env.RESEND_API_KEY;
  // 로그인 코드 주소(login@) 대신 같은 도메인의 feedback@ 에서 보낸다
  const from = process.env.MAIL_FROM?.replace(/\blogin@/, "feedback@");
  const firstLine = input.message.split("\n")[0].slice(0, 40);
  const subject = `[마이팀 캘린더 문의] ${firstLine}`;
  const text = [
    input.message,
    "",
    "---",
    `답장 주소: ${input.replyTo ?? "(없음)"}`,
    `화면 언어: ${input.locale}`,
  ].join("\n");
  if (!key || !from) {
    if (process.env.NODE_ENV === "production") throw new Error("메일 발송 설정(RESEND_API_KEY, MAIL_FROM)이 없습니다.");
    console.log(`[dev] 문의 → ${to}\n${subject}\n${text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text, ...(input.replyTo ? { reply_to: input.replyTo } : {}) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`문의 메일 발송 실패: ${res.status} ${await res.text()}`);
}
