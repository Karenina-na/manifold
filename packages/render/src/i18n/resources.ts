import en, { type RenderMessageKey, type RenderMessages } from "./en";
import zhCN from "./zh-CN";

export type RenderLocale = "en" | "zh-CN";
export type { RenderMessageKey, RenderMessages };

export const RENDER_I18N_RESOURCES: Record<RenderLocale, RenderMessages> = {
  en,
  "zh-CN": zhCN,
};

export function getRenderMessages(locale: RenderLocale = "en"): RenderMessages {
  return RENDER_I18N_RESOURCES[locale];
}

export function formatRenderDate(iso: string, locale: RenderLocale = "en"): string {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "2-digit", year: "numeric" }).format(new Date(iso));
}

export function translateRenderMessage(
  locale: RenderLocale,
  key: RenderMessageKey,
  values?: Record<string, string | number>,
): string {
  const message = getRenderMessages(locale)[key];
  if (!values) return message;
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder,
  );
}
