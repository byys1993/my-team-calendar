import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import type { Db } from "@/lib/db";
import { isPaletteIndex } from "@/lib/palette";
import { MAX_TEAMS } from "@/lib/schedule";

// 이메일 인증코드 로그인의 DB 쪽 규칙. 화면·메일 발송과 분리해 테스트할 수 있게 둔다.

export const CODE_TTL_MIN = 10;
export const RESEND_GAP_SEC = 60; // 같은 이메일로 다시 보내려면 60초 기다림
export const MAX_SENDS_PER_HOUR = 5;
export const MAX_ATTEMPTS = 5; // 코드 하나당 입력 시도
export const SESSION_DAYS = 180;

export type SelectionItem = { slug: string; color: number; enabled: boolean };

export interface User {
  id: string;
  email: string;
  locale: string | null;
  selections: SelectionItem[];
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  // 엄격한 검증 대신 흔한 오타만 거른다 (실제 확인은 코드 메일이 한다)
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET 환경변수가 없습니다.");
  return "dev-only-secret";
}

const hashCode = (email: string, code: string) => createHmac("sha256", secret()).update(`${email}:${code}`).digest("hex");
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type IssueResult = { ok: true; code: string } | { ok: false; reason: "wait" | "limit" };

// 새 코드를 만들어 저장한다. 메일 발송은 호출한 쪽이 한다.
export async function issueCode(db: Db, email: string, now = new Date()): Promise<IssueResult> {
  const [prev] = await db.query<{ last_sent_at: Date; window_start: Date; sent_count: number }>(
    "select last_sent_at, window_start, sent_count from login_code where email = $1",
    [email],
  );
  const t = now.getTime();
  let windowStart = now;
  let sentCount = 1;
  if (prev) {
    if (t - prev.last_sent_at.getTime() < RESEND_GAP_SEC * 1000) return { ok: false, reason: "wait" };
    if (t - prev.window_start.getTime() < 3600_000) {
      if (prev.sent_count >= MAX_SENDS_PER_HOUR) return { ok: false, reason: "limit" };
      windowStart = prev.window_start;
      sentCount = prev.sent_count + 1;
    }
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.query(
    `insert into login_code (email, code_hash, expires_at, attempts, last_sent_at, window_start, sent_count)
     values ($1, $2, $3, 0, $4, $5, $6)
     on conflict (email) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0,
       last_sent_at = excluded.last_sent_at, window_start = excluded.window_start, sent_count = excluded.sent_count`,
    [email, hashCode(email, code), new Date(t + CODE_TTL_MIN * 60_000).toISOString(), now.toISOString(),
      windowStart.toISOString(), sentCount],
  );
  return { ok: true, code };
}

export type VerifyResult =
  | { ok: true; user: User; token: string; expires: Date }
  | { ok: false; reason: "invalid" | "limit" };

// 코드를 확인하고, 맞으면 계정(없으면 새로)과 세션을 만든다. 코드는 한 번만 쓸 수 있다.
export async function verifyCode(db: Db, email: string, code: string, now = new Date()): Promise<VerifyResult> {
  const [row] = await db.query<{ code_hash: string; expires_at: Date; attempts: number }>(
    "select code_hash, expires_at, attempts from login_code where email = $1",
    [email],
  );
  if (!row || row.expires_at.getTime() < now.getTime()) return { ok: false, reason: "invalid" };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "limit" };
  if (!/^\d{6}$/.test(code) || hashCode(email, code) !== row.code_hash) {
    await db.query("update login_code set attempts = attempts + 1 where email = $1", [email]);
    return { ok: false, reason: row.attempts + 1 >= MAX_ATTEMPTS ? "limit" : "invalid" };
  }
  // 성공: 코드는 즉시 무효화 (발송 횟수 기록은 남긴다)
  await db.query("update login_code set expires_at = $2 where email = $1", [email, now.toISOString()]);
  const [user] = await db.query<User>(
    `insert into app_user (email, last_login_at) values ($1, $2)
     on conflict (email) do update set last_login_at = excluded.last_login_at
     returning id, email, locale, selections`,
    [email, now.toISOString()],
  );
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await db.query("insert into user_session (token_hash, user_id, expires_at) values ($1, $2, $3)", [
    hashToken(token),
    user.id,
    expires.toISOString(),
  ]);
  return { ok: true, user, token, expires };
}

export async function userFromToken(db: Db, token: string | undefined, now = new Date()): Promise<User | null> {
  if (!token) return null;
  const [user] = await db.query<User>(
    `select u.id, u.email, u.locale, u.selections from user_session s join app_user u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > $2`,
    [hashToken(token), now.toISOString()],
  );
  return user ?? null;
}

export async function endSession(db: Db, token: string): Promise<void> {
  await db.query("delete from user_session where token_hash = $1", [hashToken(token)]);
}

// 화면에서 온 선택 목록을 검증한다 (최대 10팀, 알려진 모양만)
export function cleanSelections(raw: unknown): SelectionItem[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_TEAMS) return null;
  const out: SelectionItem[] = [];
  for (const s of raw) {
    if (typeof s?.slug !== "string" || !/^[a-z0-9-]{1,64}$/.test(s.slug)) return null;
    const color = Number(s.color);
    if (!isPaletteIndex(color)) return null;
    if (out.some((o) => o.slug === s.slug)) continue;
    out.push({ slug: s.slug, color, enabled: s.enabled !== false });
  }
  return out;
}

export async function updateUser(
  db: Db,
  userId: string,
  patch: { selections?: SelectionItem[]; locale?: string },
): Promise<void> {
  if (patch.selections) {
    await db.query("update app_user set selections = $2::text::jsonb where id = $1", [userId, JSON.stringify(patch.selections)]);
  }
  if (patch.locale) await db.query("update app_user set locale = $2 where id = $1", [userId, patch.locale]);
}

// 계정과 세션·코드를 모두 지운다
export async function deleteUser(db: Db, user: User): Promise<void> {
  await db.query("delete from app_user where id = $1", [user.id]);
  await db.query("delete from login_code where email = $1", [user.email]);
}

// 고정 창(window) 방식 요청 제한. 허용이면 true. IP 등 개인 정보는 해시로만 저장한다.
export async function hitRateLimit(db: Db, key: string, limit: number, windowSec: number, now = new Date()): Promise<boolean> {
  const hashed = createHash("sha256").update(`${secret()}:${key}`).digest("hex").slice(0, 32);
  const [row] = await db.query<{ count: number }>(
    `insert into rate_limit (key, window_start, count) values ($1, $2, 1)
     on conflict (key) do update set
       count = case when rate_limit.window_start < $2::timestamptz - make_interval(secs => $3) then 1 else rate_limit.count + 1 end,
       window_start = case when rate_limit.window_start < $2::timestamptz - make_interval(secs => $3) then $2::timestamptz else rate_limit.window_start end
     returning count`,
    [hashed, now.toISOString(), windowSec],
  );
  return row.count <= limit;
}
