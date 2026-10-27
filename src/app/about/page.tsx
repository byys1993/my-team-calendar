import type { Metadata } from "next";
import Link from "next/link";
import { MESSAGES } from "@/i18n";
import { getLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const m = MESSAGES[await getLocale()];
  return {
    title: `${m.aboutPage.title} · ${m.meta.title}`,
    description: m.aboutPage.lead,
    alternates: { canonical: "/about" },
    openGraph: { title: m.aboutPage.title, description: m.aboutPage.lead, url: "/about" },
  };
}

// 서비스 소개: 무엇을 하는지, 데이터는 어디서 오는지, 누가 운영하는지 (검색엔진·AI 검색이 신뢰를 판단할 때도 쓴다)
export default async function AboutPage() {
  const { aboutPage: a } = MESSAGES[await getLocale()];
  return (
    <main className="app privacy about">
      <h1>{a.title}</h1>
      <p>{a.lead}</p>
      <h2>{a.featuresTitle}</h2>
      <ul>
        {a.features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <h2>{a.dataTitle}</h2>
      <p>{a.data}</p>
      <h2>{a.whoTitle}</h2>
      <p>{a.who}</p>
      <p>{a.builtWith}</p>
      <p className="muted">{a.contact}</p>
      <p>
        <Link href="/">{a.back}</Link>
      </p>
    </main>
  );
}
