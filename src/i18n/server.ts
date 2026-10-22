import { cookies, headers } from "next/headers";
import { isLocale, LOCALE_COOKIE, matchLocale, type Locale } from "./config";

// 화면 언어: 직접 고른 언어(쿠키) → 브라우저 언어(Accept-Language) → 영어
export async function getLocale(): Promise<Locale> {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return matchLocale((await headers()).get("accept-language"));
}
