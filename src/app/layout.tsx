import type { Metadata, Viewport } from "next";
import { isRtl } from "@/i18n/config";
import { MESSAGES } from "@/i18n";
import { getLocale } from "@/i18n/server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { meta } = MESSAGES[await getLocale()];
  return { title: meta.title, description: meta.description };
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
