import { NextResponse } from "next/server";
import { unsubscribe } from "@/lib/auth/core";
import { getDb } from "@/lib/db";

// POST /api/unsubscribe?u=<계정 id>&s=<서명> → 그 계정의 경기 알림 메일을 끈다 (로그인 불필요, 서명으로 확인)
// - 메일 앱의 원클릭 구독 취소(RFC 8058, 본문 'List-Unsubscribe=One-Click')에는 200 으로 답한다.
// - 수신 거부 화면의 버튼으로 오면 결과 화면으로 돌려보낸다.
export async function POST(req: Request) {
  const url = new URL(req.url);
  const ok = await unsubscribe(getDb(), url.searchParams.get("u") ?? "", url.searchParams.get("s") ?? "");
  const body = await req.text().catch(() => "");
  if (body.includes("List-Unsubscribe=One-Click")) {
    return new NextResponse(ok ? "ok" : "invalid", { status: ok ? 200 : 400 });
  }
  return NextResponse.redirect(new URL(`/unsubscribe?${ok ? "done=1" : "invalid=1"}`, url), 303);
}
