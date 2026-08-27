import type { Content } from "@manifold/contracts";

type Thought = Extract<Content, { kind: "THOUGHT" }>;

export interface ThoughtTimelineItem extends Thought {
  day: number;
}

export interface ThoughtMonthGroup {
  key: string;
  year: number;
  month: string;
  label: string;
  items: ThoughtTimelineItem[];
}

export interface ThoughtYearGroup {
  year: number;
  months: ThoughtMonthGroup[];
}

export function formatThoughtDate(value: string | null) {
  if (!value) return "Unpublished";
  return new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

export function groupThoughtsByMonth(items: Thought[]) {
  const groups: ThoughtMonthGroup[] = [];

  for (const item of items) {
    const date = new Date(item.publishedAt ?? item.createdAt);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    let group = groups.at(-1);
    if (group?.key !== key) {
      group = {
        key,
        year: date.getUTCFullYear(),
        month: new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(date),
        label: new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(date),
        items: [],
      };
      groups.push(group);
    }
    group.items.push({ ...item, day: date.getUTCDate() });
  }

  return groups;
}

export function groupThoughtsByYear(items: Thought[]) {
  const years: ThoughtYearGroup[] = [];

  for (const group of groupThoughtsByMonth(items)) {
    let yearGroup = years.at(-1);
    if (yearGroup?.year !== group.year) {
      yearGroup = { year: group.year, months: [] };
      years.push(yearGroup);
    }
    yearGroup.months.push(group);
  }

  return years;
}
