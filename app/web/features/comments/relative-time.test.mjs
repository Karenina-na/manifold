import assert from "node:assert/strict";
import test from "node:test";
import { formatRelativeTime } from "./relative-time.ts";

const NOW = Date.parse("2026-08-29T12:00:00Z");

test("describes sub-minute age as just now", () => {
  assert.equal(formatRelativeTime("2026-08-29T11:59:40Z", NOW), "just now");
});

test("describes recent age in minutes, hours and days", () => {
  assert.equal(formatRelativeTime("2026-08-29T11:30:00Z", NOW), "30 minutes ago");
  assert.equal(formatRelativeTime("2026-08-29T06:00:00Z", NOW), "6 hours ago");
  assert.equal(formatRelativeTime("2026-08-27T12:00:00Z", NOW), "2 days ago");
});

test("falls back to an absolute date beyond a month", () => {
  assert.equal(formatRelativeTime("2026-05-01T00:00:00Z", NOW), "May 1, 2026");
});

test("returns an empty string for unparseable values", () => {
  assert.equal(formatRelativeTime("not-a-date", NOW), "");
});
