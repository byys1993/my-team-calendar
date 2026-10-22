import { unstable_cache } from "next/cache";
import { CalendarApp } from "@/components/CalendarApp";
import type { Locale } from "@/i18n/config";
import { I18nProvider } from "@/i18n/client";
import { MESSAGES } from "@/i18n";
import { getLocale } from "@/i18n/server";
import { loginEnabled } from "@/lib/auth/mailer";
import { getDb } from "@/lib/db";
import { getCatalog } from "@/lib/schedule";

// 빌드 때 DB에 접속하지 않도록 요청 시점에 그리고, 팀·대회 목록과 '마지막 업데이트'는 언어별로 5분 캐시한다.
// (관리자에서 팀 이름을 고치면 'catalog' 태그로 바로 비운다)
export const dynamic = "force-dynamic";

// 문의·제안을 받을 주소. Vercel 환경 변수 CONTACT_EMAIL 로 바꿀 수 있고, 없으면 하단에 표시하지 않는다.
const contactEmail = () => {
  const v = process.env.CONTACT_EMAIL?.trim();
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
};

const cachedCatalog = unstable_cache((locale: Locale) => getCatalog(getDb(), locale), ["catalog"], {
  revalidate: 300,
  tags: ["catalog"],
});

export default async function Home() {
  const locale = await getLocale();
  return (
    <I18nProvider locale={locale} messages={MESSAGES[locale]}>
      <CalendarApp
        catalog={await cachedCatalog(locale)}
        loginEnabled={loginEnabled()}
        contactEmail={contactEmail()}
      />
    </I18nProvider>
  );
}
