"use client";

import { RenderI18nProvider } from "@manifold/render";
import i18next from "i18next";
import { useRouter } from "next/navigation";
import { I18nextProvider, initReactI18next, useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { defaultNamespace, resources } from "../../i18n/i18n";
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, localeCookie, parseLocale, parseLocaleCookie, resolveLocale, type Locale } from "../../i18n/locale";

export function I18nProvider({ children, initialLocale, detectClientLocale = false }: { children: React.ReactNode; initialLocale: Locale; detectClientLocale?: boolean }) {
  const [instance] = useState(() => {
    const next = i18next.createInstance();
    void next.use(initReactI18next).init({
      resources,
      lng: initialLocale,
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: Object.keys(resources),
      defaultNS: defaultNamespace,
      interpolation: { escapeValue: false },
      initImmediate: false,
      react: { useSuspense: false },
    });
    return next;
  });

  useEffect(() => {
    const locale = detectClientLocale
      ? resolveLocale(parseLocaleCookie(document.cookie), navigator.languages?.join(",") ?? navigator.language)
      : initialLocale;
    if (instance.resolvedLanguage !== locale) void instance.changeLanguage(locale);
    document.documentElement.lang = locale;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Storage can be unavailable in private browsing; the cookie remains authoritative.
    }
  }, [detectClientLocale, initialLocale, instance]);

  return <I18nextProvider i18n={instance}><RenderLocaleBridge>{children}</RenderLocaleBridge></I18nextProvider>;
}

function RenderLocaleBridge({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation();
  const locale = parseLocale(i18n.resolvedLanguage ?? i18n.language) ?? DEFAULT_LOCALE;
  return <RenderI18nProvider locale={locale}>{children}</RenderI18nProvider>;
}

export function useLocale() {
  const { i18n, t } = useTranslation();
  const router = useRouter();
  const locale = parseLocale(i18n.resolvedLanguage ?? i18n.language) ?? DEFAULT_LOCALE;

  const setLocale = async (nextLocale: Locale) => {
    if (nextLocale === locale) return;
    document.cookie = localeCookie(nextLocale, window.location.protocol === "https:");
    await i18n.changeLanguage(nextLocale);
    document.documentElement.lang = nextLocale;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    } catch {
      // Keep the cookie and in-memory language usable when storage is unavailable.
    }
    router.refresh();
  };

  return { locale, setLocale, t };
}
