import assert from "node:assert/strict";
import test from "node:test";
import { NOW_TOKEN, formatPeriod, parsePeriod, periodYears } from "../src/period.ts";

test("formatPeriod builds the range text from start/end", () => {
  assert.equal(formatPeriod("2020", "2024"), "2020 - 2024");
  assert.equal(formatPeriod("2020", ""), "2020 - Now");
  assert.equal(formatPeriod("", "2024"), "2024 - Now");
  assert.equal(formatPeriod("", ""), "");
  assert.equal(formatPeriod("2020", "Now"), "2020 - Now");
});

test("parsePeriod round-trips generated periods", () => {
  assert.deepEqual(parsePeriod("2020 - 2024"), { start: "2020", end: "2024", legacy: false });
  assert.deepEqual(parsePeriod("2020 - Now"), { start: "2020", end: "", legacy: false });
  assert.deepEqual(parsePeriod("2020-01 - 2024-06"), { start: "2020-01", end: "2024-06", legacy: false });
  assert.deepEqual(parsePeriod(""), { start: "", end: "", legacy: false });
});

test("parsePeriod treats free-text legacy values as read-only", () => {
  for (const raw of ["Ongoing", "Now", "Present", "2020 – 2024", "2020—2024", "circa 2019"]) {
    assert.deepEqual(parsePeriod(raw), { start: "", end: "", legacy: true }, `expected legacy for ${JSON.stringify(raw)}`);
  }
});

test("periodYears lists newest year first down to 2000", () => {
  const years = periodYears(2026);
  assert.equal(years[0], 2026);
  assert.equal(years.at(-1), 2000);
  assert.equal(years.length, 2026 - 2000 + 1);
  assert.equal(NOW_TOKEN, "Now");
});
