// Cloudflare Turnstile (사람 확인). 로그인 코드 요청을 자동화로 남용하지 못하게 한다.
// TURNSTILE_SITE_KEY·TURNSTILE_SECRET_KEY 가 둘 다 있을 때만 켜진다 (없으면 확인 없이 동작).

export function turnstileSiteKey(): string | null {
  return process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY ? process.env.TURNSTILE_SITE_KEY : null;
}

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
  token: unknown,
  ip: string | null,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !process.env.TURNSTILE_SITE_KEY) return true;
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set("remoteip", ip);
  try {
    const res = await fetcher(VERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(10_000) });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    console.error("Turnstile 확인 실패", err);
    return false;
  }
}
