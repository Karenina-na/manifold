import assert from "node:assert/strict";
import test from "node:test";
import { archiveHref, clampPage, serializeArchiveParams } from "./archive-url.ts";

test("omits empty filters and page 1 from the serialized query", () => {
  assert.equal(serializeArchiveParams({ query: "", tag: "", page: 1 }), "");
});

test("serializes query, tag, page and extra params with trimmed values", () => {
  assert.equal(
    serializeArchiveParams({ query: " boundary ", tag: " go ", page: 3 }, { sort: "oldest", noAi: undefined }),
    "q=boundary&tag=go&page=3&sort=oldest",
  );
});

test("drops page param once the archive is back on page 1", () => {
  assert.equal(serializeArchiveParams({ query: "flow", tag: "", page: 1 }), "q=flow");
});

test("builds clean archive hrefs", () => {
  assert.equal(archiveHref("/writing", { query: "", tag: "", page: 1 }), "/writing");
  assert.equal(archiveHref("/thoughts", { query: "flow", tag: "", page: 2 }), "/thoughts?q=flow&page=2");
  assert.equal(archiveHref("/writing", { query: "", tag: "go", page: 1 }, { sort: "oldest", noAi: "1" }), "/writing?tag=go&sort=oldest&noAi=1");
});

test("clamps pages into the valid range", () => {
  assert.equal(clampPage(0, 5), 1);
  assert.equal(clampPage(9, 5), 5);
  assert.equal(clampPage(3, 1), 1);
  assert.equal(clampPage(2, 0), 1);
});
