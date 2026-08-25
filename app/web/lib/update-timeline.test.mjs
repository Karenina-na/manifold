import assert from "node:assert/strict";
import test from "node:test";
import { buildUpdateTimeline } from "./update-timeline.ts";

function content(id, updatedAt, kind = "THOUGHT") {
  return { id, kind, status: "PUBLISHED", slug: id, title: id, summary: `${id} summary`, tags: [], publishedAt: updatedAt, createdAt: updatedAt, updatedAt, version: 1, href: `/${id}`, metadata: {} };
}

test("keeps the ten newest updates and creates evenly spaced month markers", () => {
  const items = Array.from({ length: 12 }, (_, index) => content(`item-${index}`, `2026-${String(Math.floor(index / 4) + 1).padStart(2, "0")}-${String((index % 4) * 7 + 2).padStart(2, "0")}T00:00:00Z`));
  const timeline = buildUpdateTimeline(items);

  assert.equal(timeline.points.length, 10);
  assert.deepEqual(timeline.months.map((month) => month.position), [0, 50, 100]);
  assert.equal(timeline.points[0].id, "item-2");
  assert.equal(timeline.points.at(-1)?.id, "item-11");
});

test("positions updates within one month by day while preserving chronological order", () => {
  const timeline = buildUpdateTimeline([
    content("late", "2026-08-28T00:00:00Z", "ARTICLE"),
    content("early", "2026-08-02T00:00:00Z"),
  ]);

  assert.equal(timeline.months.length, 1);
  assert.ok(timeline.points[0].position < timeline.points[1].position);
  assert.equal(timeline.points.at(-1)?.updates[0].kind, "ARTICLE");
});

test("groups updates that share a date into one timeline point", () => {
  const timeline = buildUpdateTimeline([
    content("first", "2026-08-25T08:00:00Z"),
    content("second", "2026-08-25T09:00:00Z"),
    content("third", "2026-08-25T10:00:00Z"),
  ]);

  assert.equal(timeline.points.length, 1);
  assert.equal(timeline.points[0].updates.length, 3);
  assert.deepEqual(timeline.points[0].updates.map((point) => point.id), ["third", "second", "first"]);
});
