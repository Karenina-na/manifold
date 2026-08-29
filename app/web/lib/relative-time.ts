const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const DATE_WINDOW_MS = 30 * DAY_MS;

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const absolute = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

export function formatRelativeTime(value: string, now = Date.now()) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "";
  const elapsed = now - timestamp;
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return relative.format(-Math.floor(elapsed / MINUTE_MS), "minute");
  if (elapsed < DAY_MS) return relative.format(-Math.floor(elapsed / HOUR_MS), "hour");
  if (elapsed < DATE_WINDOW_MS) return relative.format(-Math.floor(elapsed / DAY_MS), "day");
  return absolute.format(new Date(timestamp));
}
