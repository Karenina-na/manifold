import type { Content } from "@manifold/contracts";

const MONTHS_IN_YEAR = 12;

export interface UpdateTimelineMonth {
  key: string;
  label: string;
  position: number;
}

export interface UpdateTimelinePoint {
  id: string;
  date: string;
  monthKey: string;
  position: number;
  edge: "start" | "middle" | "end";
  updates: UpdateTimelineEntry[];
}

export interface UpdateTimelineEntry {
  id: string;
  kind: Content["kind"];
  href: string;
  title: string;
  summary: string;
  date: string;
}

export interface UpdateTimeline {
  months: UpdateTimelineMonth[];
  points: UpdateTimelinePoint[];
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthIndex(key: string) {
  const [year, month] = key.split("-").map(Number);
  return year * MONTHS_IN_YEAR + month - 1;
}

function formatMonth(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function daysInMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

function clamp(value: number) {
  return Math.min(100, Math.max(0, value));
}

export function buildUpdateTimeline(items: Content[]): UpdateTimeline {
  const dated = items
    .map((item) => ({ item, date: new Date(item.updatedAt || item.publishedAt || item.createdAt) }))
    .filter(({ date }) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(-10);

  if (!dated.length) return { months: [], points: [] };

  const firstMonth = monthIndex(monthKey(dated[0].date));
  const lastMonth = monthIndex(monthKey(dated[dated.length - 1].date));
  const monthCount = lastMonth - firstMonth + 1;
  const monthDenominator = Math.max(1, monthCount - 1);
  const months = Array.from({ length: monthCount }, (_, index) => {
    const absoluteIndex = firstMonth + index;
    const year = Math.floor(absoluteIndex / MONTHS_IN_YEAR);
    const month = absoluteIndex % MONTHS_IN_YEAR;
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;
    return { key, label: formatMonth(key), position: (index / monthDenominator) * 100 };
  });

  const groups = new Map<string, typeof dated>();
  for (const entry of dated) {
    const key = entry.date.toISOString().slice(0, 10);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }

  const points = [...groups.values()].map((entries) => {
    const date = entries[entries.length - 1].date;
    const itemMonth = monthIndex(monthKey(date));
    const monthOffset = itemMonth - firstMonth;
    const dayProgress = (date.getUTCDate() - 1) / Math.max(1, daysInMonth(date) - 1);
    const position = monthCount === 1
      ? dayProgress * 100
      : ((monthOffset + dayProgress) / monthDenominator) * 100;
    const edge: UpdateTimelinePoint["edge"] = position < 32 ? "start" : position > 68 ? "end" : "middle";
    return {
      id: entries.map(({ item }) => item.id).join("-"),
      date: entries[entries.length - 1].item.updatedAt || entries[entries.length - 1].item.publishedAt || entries[entries.length - 1].item.createdAt,
      monthKey: monthKey(date),
      position: clamp(position),
      edge,
      updates: entries.slice().reverse().map(({ item }) => ({
        id: item.id,
        kind: item.kind,
        href: item.href,
        title: item.title || "Untitled thought",
        summary: item.summary || "A quiet note waiting for its next sentence.",
        date: item.updatedAt || item.publishedAt || item.createdAt,
      })),
    };
  });

  return { months, points };
}
