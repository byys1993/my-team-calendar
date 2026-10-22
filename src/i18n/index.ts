import type { Locale } from "./config";
import { ar } from "./messages/ar";
import { de } from "./messages/de";
import { en, type Messages } from "./messages/en";
import { es } from "./messages/es";
import { fr } from "./messages/fr";
import { ja } from "./messages/ja";
import { ko } from "./messages/ko";
import { pt } from "./messages/pt";
import { ru } from "./messages/ru";
import { zh } from "./messages/zh";

export type { Messages } from "./messages/en";

export const MESSAGES: Record<Locale, Messages> = { ko, en, zh, ja, es, fr, de, pt, ru, ar };

// '{name}' 자리를 값으로 바꾼다
export function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) => (key in vars ? String(vars[key]) : all));
}
