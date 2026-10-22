"use client";

import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, LOCALE_NAMES, LOCALES, isLocale, type Locale } from "@/i18n/config";
import { useI18n } from "@/i18n/client";

// 언어를 바꾸면 쿠키에 저장하고 서버가 그 언어로 다시 그린다 (팀·대회 이름도 바뀜)
export function LanguageSelect({ onChange }: { onChange?: (l: Locale) => void }) {
  const { locale, m } = useI18n();
  const router = useRouter();
  return (
    <select
      className="lang-select"
      aria-label={m.app.language}
      value={locale}
      onChange={(e) => {
        const next = e.target.value;
        if (!isLocale(next)) return;
        document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
        onChange?.(next);
        router.refresh();
      }}
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>
          {LOCALE_NAMES[l]}
        </option>
      ))}
    </select>
  );
}
