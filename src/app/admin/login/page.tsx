import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { adminEnabled, isAdmin } from "@/lib/admin/auth";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "관리자 로그인 · 마이팀 캘린더", robots: { index: false } };
// 로그인 쿠키를 확인하므로 요청마다 그린다
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await isAdmin()) redirect("/admin");
  return (
    <main className="admin admin-login">
      <h1>관리자 로그인</h1>
      {adminEnabled() ? (
        <LoginForm />
      ) : (
        <p className="error">관리자 기능이 꺼져 있습니다. 환경변수 ADMIN_PASSWORD 를 설정해 주세요.</p>
      )}
    </main>
  );
}
