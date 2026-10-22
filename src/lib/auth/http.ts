import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { userFromToken, type User } from "./core";

export const SESSION_COOKIE = "mtc_session";

// 로그인 API 는 JSON 본문만 받는다. 다른 사이트의 일반 폼 전송(CSRF)은 JSON 헤더를 붙일 수 없어 여기서 막힌다.
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  if (!req.headers.get("content-type")?.includes("application/json")) return null;
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(req.url).host) return null;
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function currentUser(): Promise<User | null> {
  return userFromToken(getDb(), (await cookies()).get(SESSION_COOKIE)?.value);
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export function setSessionCookie(res: NextResponse, token: string, expires: Date) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export const publicUser = (u: User) => ({ email: u.email, locale: u.locale, selections: u.selections });

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
