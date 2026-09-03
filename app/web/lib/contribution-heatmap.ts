import type { Content } from "@manifold/contracts";

export type ContributionItem = Content;

export interface ContributionEntry {
  id: string;
  kind: Content["kind"];
  href: string;
  title: string;
  summary: string;
  date: string;
}

export interface ContributionDay {
  date: string;
  count: number;
  level: number;
  updates: ContributionEntry[];
}

export interface ContributionMonth {
  label: string;
  week: number;
}

export interface ContributionCalendar {
  year: number;
  total: number;
  days: ContributionDay[];
  weeks: Array<Array<ContributionDay | null>>;
  months: ContributionMonth[];
}

function itemDate(item: ContributionItem) {
  return item.updatedAt || item.publishedAt || item.createdAt || null;
}

function parseDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dayDifference(start: Date, end: Date) {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

function toEntry(item: ContributionItem): ContributionEntry {
  return {
    id: item.id,
    kind: item.kind,
    href: item.kind === "ARTICLE" ? `/writing/${encodeURIComponent(item.slug)}` : `/thoughts/${encodeURIComponent(item.slug)}`,
    title: item.title || "Untitled thought",
    summary: item.summary || "A quiet note waiting for its next sentence.",
    date: itemDate(item) || item.publishedAt || item.createdAt || item.updatedAt || "",
  };
}

export function getContributionYears(items: ContributionItem[]) {
  return [...new Set(items.map((item) => parseDate(itemDate(item))?.getUTCFullYear()).filter((year): year is number => year !== undefined))].sort((a, b) => b - a);
}

export function buildContributionCalendar(items: ContributionItem[], year: number): ContributionCalendar {
  const firstDay = new Date(Date.UTC(year, 0, 1));
  const lastDay = new Date(Date.UTC(year, 11, 31));
  const calendarStart = new Date(firstDay);
  calendarStart.setUTCDate(calendarStart.getUTCDate() - calendarStart.getUTCDay());
  const calendarEnd = new Date(lastDay);
  calendarEnd.setUTCDate(calendarEnd.getUTCDate() + (6 - calendarEnd.getUTCDay()));
  const dayItems = new Map<string, ContributionItem[]>();

  for (const item of items) {
    const date = parseDate(itemDate(item));
    if (!date || date.getUTCFullYear() !== year) continue;
    const key = dateKey(date);
    const list = dayItems.get(key) ?? [];
    list.push(item);
    dayItems.set(key, list);
  }

  const days: ContributionDay[] = [];
  const weeks: Array<Array<ContributionDay | null>> = [];
  const totalDays = dayDifference(calendarStart, calendarEnd) + 1;
  for (let offset = 0; offset < totalDays; offset += 1) {
    const date = new Date(calendarStart);
    date.setUTCDate(calendarStart.getUTCDate() + offset);
    const key = dateKey(date);
    const isInYear = date.getUTCFullYear() === year;
    const updates = (dayItems.get(key) ?? []).map(toEntry);
    const day = isInYear ? { date: key, count: updates.length, level: Math.min(4, updates.length), updates } : null;
    if (day) days.push(day);
    const week = Math.floor(offset / 7);
    weeks[week] ??= [];
    weeks[week].push(day);
  }

  const months = Array.from({ length: 12 }, (_, month) => {
    const date = new Date(Date.UTC(year, month, 1));
    return {
      label: new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(date),
      week: Math.floor(dayDifference(calendarStart, date) / 7),
    };
  });

  return { year, total: days.reduce((sum, day) => sum + day.count, 0), days, weeks, months };
}
