// Period picker helpers for education/experience rows. A "period" is stored as
// plain text (e.g. "2020 - 2024", "2020 - Now") so legacy values like "Ongoing"
// keep working; the admin UI parses and regenerates it from two selects.

export const NOW_TOKEN = 'Now'

const MONTH_RE = /^\d{4}(-\d{2})?$/

/**
 * Build a period string from a start/end value ("2020-01", "2020" or "").
 * An empty end is written as "Now". Returns "" when both are empty.
 */
export function formatPeriod(start: string, end: string): string {
  const s = start.trim()
  const e = end.trim()
  if (!s && !e) return ''
  if (!s) return `${e} - ${NOW_TOKEN}`
  if (!e) return `${s} - ${NOW_TOKEN}`
  return `${s} - ${e}`
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
    const end = endRaw.toLowerCase() === NOW_TOKEN.toLowerCase() ? '' : endRaw
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
