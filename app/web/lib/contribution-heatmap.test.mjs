import assert from "node:assert/strict";
import test from "node:test";
import { buildContributionCalendar, getContributionYears } from "./contribution-heatmap.ts";

function content(id, updatedAt) {
  return { id, kind: "THOUGHT", updatedAt, publishedAt: updatedAt, createdAt: updatedAt };
}

test("returns available years in descending order", () => {
  assert.deepEqual(getContributionYears([
    content("old", "2024-03-01T10:00:00Z"),
    content("new", "2026-01-02T10:00:00Z"),
    content("middle", "2025-08-01T10:00:00Z"),
  ]), [2026, 2025, 2024]);
});

test("counts updates by UTC date and assigns contribution levels", () => {
  const calendar = buildContributionCalendar([
    content("one", "2026-01-01T23:00:00Z"),
    content("two", "2026-01-01T02:00:00Z"),
    content("three", "2026-01-01T04:00:00Z"),
    content("four", "2026-01-01T06:00:00Z"),
    content("other-year", "2025-12-31T23:59:00Z"),
  ], 2026);

  assert.equal(calendar.total, 4);
  assert.equal(calendar.days.find((day) => day.date === "2026-01-01")?.count, 4);
  assert.equal(calendar.days.find((day) => day.date === "2026-01-01")?.level, 4);
  assert.equal(calendar.days.find((day) => day.date === "2025-12-31"), undefined);
  assert.equal(calendar.weeks.length >= 52, true);
  assert.equal(calendar.months[0].label, "Jan");
});

test("builds a leap-year calendar with empty days", () => {
  const calendar = buildContributionCalendar([], 2024);

  assert.equal(calendar.days.length, 366);
  assert.equal(calendar.total, 0);
  assert.equal(calendar.weeks.length, 53);
  assert.equal(calendar.days.find((day) => day.date === "2024-02-29")?.level, 0);
});

test("uses published date when an update timestamp is unavailable", () => {
  const calendar = buildContributionCalendar([{ publishedAt: "2026-04-02T12:00:00Z" }], 2026);

  assert.equal(calendar.total, 1);
  assert.equal(calendar.days.find((day) => day.date === "2026-04-02")?.count, 1);
});
