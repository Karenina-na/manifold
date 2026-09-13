import { getRenderMessages, translateRenderMessage, type RenderLocale } from './i18n/resources'

// Period picker helpers for education/experience rows. A "period" is stored as
// plain text (e.g. "2020 - 2024", "2020 - Now") so legacy values like "Ongoing"
// keep working; the admin UI parses and regenerates it from two selects.

export const NOW_TOKEN = 'Now'

const CURRENT_TOKENS = new Set([getRenderMessages('en').now.toLowerCase(), getRenderMessages('zh-CN').now.toLowerCase()])
const MONTH_RE = /^\d{4}(-\d{2})?$/

/**
 * Build a period string from a start/end value ("2020-01", "2020" or "").
 * An empty end is written as "Now". Returns "" when both are empty.
 */
export function formatPeriod(start: string, end: string, locale: RenderLocale = 'en'): string {
  const s = start.trim()
  const e = end.trim()
  if (!s && !e) return ''
  const now = translateRenderMessage(locale, 'now')
  const normalizedEnd = CURRENT_TOKENS.has(e.toLowerCase()) ? '' : e
  if (!s) return `${normalizedEnd} - ${now}`
  if (!normalizedEnd) return `${s} - ${now}`
  return `${s} - ${normalizedEnd}`
}

export interface ParsedPeriod {
  start: string
  end: string
  /** True when the raw text doesn't match the "X - Y" shape and should be shown read-only. */
  legacy: boolean
}

/** Parse a stored period string back into start/end select values. */
export function parsePeriod(value: string): ParsedPeriod {
  const trimmed = value.trim()
  if (!trimmed) return { start: '', end: '', legacy: false }
  if (/^(now|ongoing|present|current)$/i.test(trimmed)) {
    return { start: '', end: '', legacy: true }
  }
  const match = /^(\S+)\s*-\s*(\S+)$/.exec(trimmed)
  if (match) {
    const start = match[1]
    const endRaw = match[2]
    const end = CURRENT_TOKENS.has(endRaw.toLowerCase()) ? '' : endRaw
    if (MONTH_RE.test(start) && (end === '' || MONTH_RE.test(end))) {
      return { start, end, legacy: false }
    }
  }
  return { start: '', end: '', legacy: true }
}

/** Years to offer in the period selects (newest first). */
export function periodYears(nowYear: number): number[] {
  const years: number[] = []
  for (let year = nowYear; year >= 2000; year -= 1) years.push(year)
  return years
}
