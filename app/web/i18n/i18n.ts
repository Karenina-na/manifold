import i18next, { type TFunction } from "i18next";
import { en } from "./i18n-en";
import { zhCN } from "./i18n-zh-cn";
import { DEFAULT_LOCALE, type Locale } from "./locale";

export const defaultNamespace = "translation";
export const resources = {
  en: { translation: en },
  "zh-CN": { translation: zhCN },
} as const;

const serverI18n = i18next.createInstance();
void serverI18n.init({
  resources,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: Object.keys(resources),
  defaultNS: defaultNamespace,
  interpolation: { escapeValue: false },
  initImmediate: false,
});

export function translator(locale: Locale): TFunction {
  return serverI18n.getFixedT(locale, defaultNamespace);
}

export function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatDate(value: string | number | Date, locale: Locale, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat(locale, options).format(new Date(value));
}
