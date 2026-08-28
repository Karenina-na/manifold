import assert from "node:assert/strict";
import test from "node:test";
import { readSearchPage, readSearchParam, readSearchText } from "./search-params.ts";

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
