const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const DATE_WINDOW_MS = 30 * DAY_MS;

import type { Locale } from "../../i18n/locale";

export function formatRelativeTime(value: string, now = Date.now(), locale: Locale = "en") {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "";
  const elapsed = now - timestamp;
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  if (elapsed < MINUTE_MS) return locale === "zh-CN" ? "刚刚" : "just now";
  if (elapsed < HOUR_MS) return relative.format(-Math.floor(elapsed / MINUTE_MS), "minute");
  if (elapsed < DAY_MS) return relative.format(-Math.floor(elapsed / HOUR_MS), "hour");
  if (elapsed < DATE_WINDOW_MS) return relative.format(-Math.floor(elapsed / DAY_MS), "day");
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(new Date(timestamp));
}
