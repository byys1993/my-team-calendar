import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { logout } from "../actions";

export const metadata: Metadata = { title: "관리자 · 마이팀 캘린더", robots: { index: false } };
// 로그인 확인과 DB 조회가 필요한 화면이라 빌드 때 미리 만들지 않고 요청마다 그린다 (하위 화면 모두 적용)
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="admin">
      <header className="admin-top">
        <strong>마이팀 캘린더 관리자</strong>
        <nav>
          <Link href="/admin">현황</Link>
          <Link href="/admin/upload">CSV 올리기</Link>
          <Link href="/admin/matches">경기 수정</Link>
          <Link href="/admin/teams">팀 이름</Link>
          <Link href="/">사이트 보기</Link>
        </nav>
        <form action={logout}>
          <button type="submit" className="ghost">
            로그아웃
          </button>
        </form>
      </header>
      <main>{children}</main>
    </div>
  );
}
