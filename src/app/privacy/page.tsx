import type { Metadata } from "next";
import Link from "next/link";
import { MESSAGES } from "@/i18n";
import { getLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const m = MESSAGES[await getLocale()];
  return { title: `${m.privacyPage.title} · ${m.meta.title}` };
}

// 로그인 기능으로 이메일을 받으므로 수집 항목·목적·보관·삭제 방법을 알린다
export default async function PrivacyPage() {
  const { privacyPage } = MESSAGES[await getLocale()];
  return (
    <main className="app privacy">
      <h1>{privacyPage.title}</h1>
      <ul>
        {privacyPage.body.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p>
        <Link href="/">{privacyPage.back}</Link>
      </p>
    </main>
  );
}
