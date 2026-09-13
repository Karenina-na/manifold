import type { TFunction } from 'i18next'
import { parseLocale, type Locale } from './locale.ts'

export function activeLocale(language: string): Locale {
  return parseLocale(language) ?? 'en'
}

export function formatDate(value: string | Date, locale: Locale): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
}

export function formatDateTime(value: string | Date, locale: Locale): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
}

export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value)
}

export function formatRelativeTime(value: string, _locale: Locale, t: TFunction): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000))
  if (seconds < 60) return t('dashboard.relativeNow')
  if (seconds < 3600) return t('dashboard.relativeMinutes', { count: Math.floor(seconds / 60) })
  if (seconds < 86400) return t('dashboard.relativeHours', { count: Math.floor(seconds / 3600) })
  return t('dashboard.relativeDays', { count: Math.floor(seconds / 86400) })
}
