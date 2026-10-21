import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// 관리자 인증: 비밀번호는 환경변수 ADMIN_PASSWORD 하나뿐이다.
// 로그인하면 '만료시각.서명' 쿠키를 주고, 서명 키는 비밀번호에서 만든다 (비밀번호를 바꾸면 모든 세션이 끊긴다).
export const SESSION_COOKIE = "mtc_admin";
export const SESSION_DAYS = 7;

export function sessionKey(password: string): Buffer {
  return createHmac("sha256", "my-team-calendar admin session").update(password).digest();
}

const sign = (expires: number, key: Buffer) => createHmac("sha256", key).update(String(expires)).digest("base64url");

export function createSessionToken(key: Buffer, now = Date.now()): { token: string; expires: Date } {
  const expires = now + SESSION_DAYS * 86_400_000;
  return { token: `${expires}.${sign(expires, key)}`, expires: new Date(expires) };
}

export function verifySessionToken(token: string | undefined, key: Buffer, now = Date.now()): boolean {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  const expires = Number(exp);
  if (!Number.isFinite(expires) || expires < now || !sig) return false;
  return safeEqual(sig, sign(expires, key));
}

export function checkPassword(input: string, password: string): boolean {
  // 길이가 달라도 같은 시간이 걸리도록 해시끼리 비교한다
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(input), digest(password));
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
