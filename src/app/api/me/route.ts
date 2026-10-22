import { NextResponse } from "next/server";
import { isLocale } from "@/i18n/config";
import { cleanSelections, deleteUser, isHour, isNotifyMode, isTimeZone, updateUser } from "@/lib/auth/core";
import { bad, clearSessionCookie, currentUser, publicUser, readJson } from "@/lib/auth/http";
import { getDb } from "@/lib/db";

const noStore = { "Cache-Control": "private, no-store" };

// GET /api/me → 로그인한 계정 (없으면 user: null)
export async function GET() {
  const user = await currentUser();
  return NextResponse.json({ user: user ? publicUser(user) : null }, { headers: noStore });
}

// PUT /api/me {selections?, locale?, timeZone?, notifyMode?, notifyHour?, lastTz?}
// → 내 팀·언어·시간대·알림 메일 설정 저장 (timeZone: null 이면 자동, lastTz 는 지금 브라우저 시간대)
export async function PUT(req: Request) {
  const user = await currentUser();
  if (!user) return bad("unauthorized", 401);
  const body = await readJson(req);
  if (!body) return bad("bad_request");
  const selections = body.selections === undefined ? undefined : cleanSelections(body.selections);
  if (selections === null) return bad("bad_selections");
  const locale = isLocale(body.locale) ? body.locale : undefined;
  const timeZone = body.timeZone === null ? null : isTimeZone(body.timeZone) ? body.timeZone : undefined;
  const notifyMode = isNotifyMode(body.notifyMode) ? body.notifyMode : undefined;
  const notifyHour = isHour(body.notifyHour) ? body.notifyHour : undefined;
  const lastTz = isTimeZone(body.lastTz) ? body.lastTz : undefined;
  await updateUser(getDb(), user.id, { selections, locale, timeZone, notifyMode, notifyHour, lastTz });
  return NextResponse.json({ ok: true }, { headers: noStore });
}

// DELETE /api/me → 계정과 저장된 정보 모두 삭제
export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return bad("unauthorized", 401);
  if (!(await readJson(req))) return bad("bad_request");
  await deleteUser(getDb(), user);
  const res = NextResponse.json({ ok: true }, { headers: noStore });
  clearSessionCookie(res);
  return res;
}
