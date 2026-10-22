"use client";

import { createContext, useContext, type ReactNode } from "react";
import { INTL_LOCALE, type Locale } from "./config";
import { fmt, type Messages } from "./index";

interface I18n {
  locale: Locale;
  intl: string; // Intl 에 넘길 언어 태그
  m: Messages;
  t: typeof fmt;
}

const Ctx = createContext<I18n | null>(null);

// 서버가 고른 언어의 문구만 내려받아 쓴다 (10개 언어 전부를 보내지 않음)
export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: ReactNode }) {
  return <Ctx.Provider value={{ locale, intl: INTL_LOCALE[locale], m: messages, t: fmt }}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("I18nProvider 가 필요합니다.");
  return v;
}
