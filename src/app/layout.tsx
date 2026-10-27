import type { Metadata, Viewport } from "next";
import { INTL_LOCALE, isRtl } from "@/i18n/config";
import { MESSAGES } from "@/i18n";
import { getLocale } from "@/i18n/server";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

// 검색엔진·공유 미리보기(카카오톡·SNS)에 쓰는 기본 정보. 페이지마다 제목·설명을 덮어쓸 수 있다.
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const { meta } = MESSAGES[locale];
  const title = `${meta.title} – ${meta.tagline}`;
  const google = process.env.GOOGLE_SITE_VERIFICATION;
  const naver = process.env.NAVER_SITE_VERIFICATION;
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description: meta.description,
    applicationName: meta.title,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      siteName: meta.title,
      title,
      description: meta.description,
      url: "/",
      locale: INTL_LOCALE[locale].replace("-", "_"),
    },
    twitter: { card: "summary_large_image", title, description: meta.description },
    // 구글 서치 콘솔·네이버 서치어드바이저 소유 확인 (Vercel 환경 변수에 확인 코드를 넣는다)
    verification: {
      ...(google ? { google } : {}),
      ...(naver ? { other: { "naver-site-verification": naver } } : {}),
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={isRtl(locale) ? "rtl" : "ltr"}>
      <body>{children}</body>
    </html>
  );
}
