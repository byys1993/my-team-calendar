import { unstable_cache } from "next/cache";
import { CalendarApp } from "@/components/CalendarApp";
import type { Locale } from "@/i18n/config";
import { I18nProvider } from "@/i18n/client";
import { MESSAGES } from "@/i18n";
import { getLocale } from "@/i18n/server";
import { loginEnabled } from "@/lib/auth/mailer";
import { turnstileSiteKey } from "@/lib/auth/turnstile";
import { contactEnabled } from "@/lib/contact";
import { getDb } from "@/lib/db";
import { getCatalog } from "@/lib/schedule";
import { SITE_URL } from "@/lib/site";

// 빌드 때 DB에 접속하지 않도록 요청 시점에 그리고, 팀·대회 목록과 '마지막 업데이트'는 언어별로 5분 캐시한다.
// (관리자에서 팀 이름을 고치면 'catalog' 태그로 바로 비운다)
export const dynamic = "force-dynamic";

const cachedCatalog = unstable_cache((locale: Locale) => getCatalog(getDb(), locale), ["catalog"], {
  revalidate: 300,
  tags: ["catalog"],
});

export default async function Home() {
  const locale = await getLocale();
  return (
    <I18nProvider locale={locale} messages={MESSAGES[locale]}>
      {/* 검색엔진·AI 검색이 읽는 사이트 설명 (schema.org) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebApplication",
            name: MESSAGES[locale].meta.title,
            alternateName: ["마이팀 캘린더", "My Team Calendar"],
            url: SITE_URL,
            description: MESSAGES[locale].meta.description,
            applicationCategory: "SportsApplication",
            operatingSystem: "Web",
            inLanguage: locale,
            isAccessibleForFree: true,
            offers: { "@type": "Offer", price: "0", priceCurrency: "KRW" },
          }),
        }}
      />
      <CalendarApp
        catalog={await cachedCatalog(locale)}
        loginEnabled={loginEnabled()}
        contactEnabled={contactEnabled()}
        turnstileSiteKey={turnstileSiteKey()}
      />
    </I18nProvider>
  );
}
