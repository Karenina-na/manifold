import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";
import { formatThoughtDate, groupThoughtsByMonth, groupThoughtsByYear } from "./thought-archive.ts";

const siteStyles = await readFile(resolve(import.meta.dirname, "../app/site.module.css"), "utf8");

function thought(id, publishedAt, overrides = {}) {
  return {
    id,
    kind: "THOUGHT",
    status: "PUBLISHED",
    slug: null,
    title: `Thought ${id}`,
    summary: `${id} summary`,
    tags: ["notes"],
    publishedAt,
    createdAt: publishedAt,
    updatedAt: publishedAt,
    version: 1,
    href: `/thoughts/${id}`,
    viewCount: 0,
    likeCount: 0,
    commentCount: 0,
    metadata: {},
    ...overrides,
  };
}

test("groups a Core-provided thought page by UTC month and day", () => {
  const items = [
    thought("aug-21", "2026-08-21T09:00:00Z"),
    thought("aug-07", "2026-08-07T09:00:00Z"),
    thought("jul-28", "2026-07-28T09:00:00Z"),
    thought("dec-19", "2025-12-19T09:00:00Z"),
  ];

  const groups = groupThoughtsByMonth(items);
  assert.deepEqual(groups.map((group) => group.key), ["2026-08", "2026-07", "2025-12"]);
  assert.deepEqual(groups.map((group) => [group.year, group.month]), [
    [2026, "August"],
    [2026, "July"],
    [2025, "December"],
  ]);
  assert.deepEqual(groups.flatMap((group) => group.items.map((item) => [item.id, item.day])), [
    ["aug-21", 21],
    ["aug-07", 7],
    ["jul-28", 28],
    ["dec-19", 19],
  ]);
});

test("blocks the timeline into year groups that keep UTC month order", () => {
  const items = [
    thought("aug-21", "2026-08-21T09:00:00Z"),
    thought("jul-28", "2026-07-28T09:00:00Z"),
    thought("dec-19", "2025-12-19T09:00:00Z"),
    thought("dec-02", "2025-12-02T09:00:00Z"),
  ];

  const years = groupThoughtsByYear(items);
  assert.deepEqual(years.map((yearGroup) => yearGroup.year), [2026, 2025]);
  assert.deepEqual(years.map((yearGroup) => yearGroup.months.map((group) => group.key)), [
    ["2026-08", "2026-07"],
    ["2025-12"],
  ]);
  assert.deepEqual(years.flatMap((yearGroup) => yearGroup.months.flatMap((group) => group.items.map((item) => item.id))), [
    "aug-21",
    "jul-28",
    "dec-19",
    "dec-02",
  ]);
});

test("formats thought dates in the same UTC timezone used by timeline markers", () => {
  assert.equal(formatThoughtDate("2026-08-31T23:30:00Z"), "Aug 31, 2026");
});

test("paints date markers above month ticks so ticks do not cross the day circle", () => {
  assert.match(siteStyles, /\.thoughtMonthRail \{[^}]*z-index: 1;/);
  assert.match(siteStyles, /\.thoughtMonthItems \{[^}]*z-index: 2;/);
  assert.match(siteStyles, /\.thoughtDateMarker \{[^}]*z-index: 3;/);
  assert.match(siteStyles, /\.thoughtDateMarker strong \{[^}]*z-index: 4;[^}]*background-color: var\(--surface-paper\);/);
  assert.match(siteStyles, /\.thoughtDateMarker strong \{[^}]*box-shadow: 0 0 0 3px var\(--surface-paper\);/);
});

test("keeps year headers in flow outside the per-year card surface", () => {
  assert.match(siteStyles, /\.thoughtYear \{ position: relative; \}/);
  assert.match(siteStyles, /\.thoughtYearHeader \{ display: flex;/);
  assert.match(siteStyles, /\.thoughtYearMonths::after \{[^}]*left: var\(--thought-content-offset\);/);
  assert.doesNotMatch(siteStyles, /\.thoughtYear \{[^}]*position: absolute/);
  assert.doesNotMatch(siteStyles, /\.thoughtYearHeader[^{]*\{[^}]*position: absolute/);
});
