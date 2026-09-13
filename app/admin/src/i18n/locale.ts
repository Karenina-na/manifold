export const supportedLocales = ['en', 'zh-CN'] as const

export type Locale = (typeof supportedLocales)[number]

export const localeStorageKey = 'manifold.locale'

export function parseLocale(value: string | null | undefined): Locale | null {
  if (!value) return null
  const normalized = value.trim().replace('_', '-').toLowerCase()
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN'
  return null
}

export function resolveLocale(stored: string | null | undefined, browserLanguage: string | null | undefined): Locale {
  return parseLocale(stored) ?? parseLocale(browserLanguage) ?? 'en'
}

export function getInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en'
  try {
    return resolveLocale(window.localStorage.getItem(localeStorageKey), window.navigator.language)
  } catch {
    return resolveLocale(null, window.navigator.language)
  }
}

export function toDayjsLocale(locale: Locale): string {
  return locale === 'zh-CN' ? 'zh-cn' : 'en'
}

export function toVditorLocale(locale: Locale): 'zh_CN' | 'en_US' {
  return locale === 'zh-CN' ? 'zh_CN' : 'en_US'
}
