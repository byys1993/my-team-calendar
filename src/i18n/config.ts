// 지원 언어. 화면 문구는 src/i18n/messages/<언어>.ts, 날짜·요일은 브라우저 Intl 로 그 언어에 맞게 표시한다.
export const LOCALES = ["ko", "en", "zh", "ja", "es", "fr", "de", "pt", "ru", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "mtc_locale";

// 언어 선택 메뉴에 그 언어로 표시할 이름
export const LOCALE_NAMES: Record<Locale, string> = {
  ko: "한국어",
  en: "English",
  zh: "简体中文",
  ja: "日本語",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
  ru: "Русский",
  ar: "العربية",
};

// Intl(날짜·숫자) 에 넘길 언어 태그
export const INTL_LOCALE: Record<Locale, string> = {
  ko: "ko-KR",
  en: "en-US",
  zh: "zh-CN",
  ja: "ja-JP",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  pt: "pt-BR",
  ru: "ru-RU",
  ar: "ar",
};

export const isRtl = (l: Locale) => l === "ar";

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

// Accept-Language 헤더('ko-KR,ko;q=0.9,en;q=0.8')에서 지원하는 언어 중 가장 선호하는 것
export function matchLocale(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const prefs = header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { lang: tag.toLowerCase().split("-")[0], q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  return prefs.map((p) => p.lang).find(isLocale) ?? DEFAULT_LOCALE;
}
