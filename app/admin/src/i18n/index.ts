import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en'
import zhCN from './zh-CN'
import { getInitialLocale, localeStorageKey, parseLocale, type Locale } from './locale'

export const resources = {
  en: { translation: en },
  'zh-CN': { translation: zhCN },
} as const

const initialLocale = getInitialLocale()

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale,
  fallbackLng: 'en',
  supportedLngs: ['en', 'zh-CN'],
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
})

function applyLocale(value: string): Locale {
  const locale = parseLocale(value) ?? 'en'
  if (typeof document !== 'undefined') document.documentElement.lang = locale
  return locale
}

applyLocale(initialLocale)
i18n.on('languageChanged', (value: string) => {
  const locale = applyLocale(value)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(localeStorageKey, locale)
    } catch {
      // Keep the in-memory locale usable when storage is unavailable.
    }
  }
})

export async function changeLocale(locale: Locale): Promise<void> {
  await i18n.changeLanguage(locale)
}

export default i18n
