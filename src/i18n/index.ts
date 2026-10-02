import { es, type MessageKey, type Messages } from "./es";

const catalogs: Record<string, Messages> = { es };
let active: Messages = es;

export function setLanguage(language: string) {
  active = catalogs[language] ?? es;
}

/** `t("hymnLabel", { number: 1 })` → "Himno 1". */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = active[key] ?? es[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export type { MessageKey };
