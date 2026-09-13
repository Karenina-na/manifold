import assert from "node:assert/strict";
import test from "node:test";
import { readSearchPage, readSearchParam, readSearchTags, readSearchText } from "./search-params.ts";

test("readSearchParam trims string values and ignores arrays", () => {
  assert.equal(readSearchParam({ q: "  boundary  " }, "q"), "boundary");
  assert.equal(readSearchParam({ q: ["a", "b"] }, "q"), "");
  assert.equal(readSearchParam({}, "q"), "");
  assert.equal(readSearchParam({ q: undefined }, "q"), "");
});

test("readSearchText clamps length", () => {
  assert.equal(readSearchText({ q: "x".repeat(30) }, "q", 10), "x".repeat(10));
  assert.equal(readSearchText({ q: "  hi " }, "q", 10), "hi");
});

test("readSearchPage falls back to 1 on missing or invalid values", () => {
  assert.equal(readSearchPage({}), 1);
  assert.equal(readSearchPage({ page: "3" }), 3);
  assert.equal(readSearchPage({ page: "nope" }), 1);
  assert.equal(readSearchPage({ page: "0" }), 1);
  assert.equal(readSearchPage({ page: "-4" }), 1);
});

test("readSearchTags collects repeated and comma-separated tags", () => {
  assert.deepEqual(readSearchTags({ tag: "go" }), ["go"]);
  assert.deepEqual(readSearchTags({ tag: ["go", "design"] }), ["go", "design"]);
  assert.deepEqual(readSearchTags({ tag: "go, design" }), ["go", "design"]);
  assert.deepEqual(readSearchTags({ tag: ["go,design", "notes"] }), ["go", "design", "notes"]);
  assert.deepEqual(readSearchTags({ tag: ["go", "go", " notes ", ""] }), ["go", "notes"]);
  assert.deepEqual(readSearchTags({}), []);
  assert.deepEqual(readSearchTags({ tag: 42 }), []);
});

test("readSearchTags clamps tag length and total count", () => {
  assert.deepEqual(readSearchTags({ tag: "x".repeat(90) }), ["x".repeat(80)]);
  assert.deepEqual(readSearchTags({ tag: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"] }), ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
});
