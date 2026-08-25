export type ContributionItem = {
  updatedAt?: string | null;
  publishedAt?: string | null;
  createdAt?: string | null;
};

export interface ContributionDay {
  date: string;
  count: number;
  level: number;
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
  const dayCounts = new Map<string, number>();

  for (const item of items) {
    const date = parseDate(itemDate(item));
    if (!date || date.getUTCFullYear() !== year) continue;
    const key = dateKey(date);
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
  }

  const days: ContributionDay[] = [];
  const weeks: Array<Array<ContributionDay | null>> = [];
  const totalDays = dayDifference(calendarStart, calendarEnd) + 1;
  for (let offset = 0; offset < totalDays; offset += 1) {
    const date = new Date(calendarStart);
    date.setUTCDate(calendarStart.getUTCDate() + offset);
    const key = dateKey(date);
    const isInYear = date.getUTCFullYear() === year;
    const count = dayCounts.get(key) ?? 0;
    const day = isInYear ? { date: key, count, level: Math.min(4, count) } : null;
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
