"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  getRenderMessages,
  translateRenderMessage,
  type RenderLocale,
  type RenderMessageKey,
  type RenderMessages,
} from "./i18n/resources";

export type RenderTranslate = (
  key: RenderMessageKey,
  values?: Record<string, string | number>,
) => string;

export type RenderI18n = {
  locale: RenderLocale;
  messages: RenderMessages;
  t: RenderTranslate;
};

function createRenderI18n(locale: RenderLocale): RenderI18n {
  return {
    locale,
    messages: getRenderMessages(locale),
    t: (key, values) => translateRenderMessage(locale, key, values),
  };
}

const defaultRenderI18n = createRenderI18n("en");
const RenderI18nContext = createContext<RenderI18n>(defaultRenderI18n);

export function RenderI18nProvider({
  locale = "en",
  children,
}: {
  locale?: RenderLocale;
  children: ReactNode;
}) {
  const value = useMemo(() => createRenderI18n(locale), [locale]);
  return <RenderI18nContext.Provider value={value}>{children}</RenderI18nContext.Provider>;
}

export function useRenderI18n(): RenderI18n {
  return useContext(RenderI18nContext);
}
