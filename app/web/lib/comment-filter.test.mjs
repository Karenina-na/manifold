import assert from "node:assert/strict";
import test from "node:test";
import { filterComments } from "./comment-filter.ts";

const comments = [
  { id: "one", authorName: "Anya", authorUrl: "https://anya.example", body: "The boundary is useful.", createdAt: "2026-08-24T10:00:00Z" },
  { id: "two", authorName: "Mika", body: "I would like to read more about systems.", createdAt: "2026-07-01T10:00:00Z" },
  { id: "three", authorName: "Rin", body: "A small note on boundaries.", createdAt: "2026-08-25T10:00:00Z" },
  { id: "hidden", authorName: "Secret", authorUrl: "https://secret.example", body: "hidden keyword", createdAt: "2026-08-25T11:00:00Z", hidden: true },
];

test("searches comment author names and bodies case-insensitively", () => {
  assert.deepEqual(filterComments(comments, "BOUNDAR", "all").map((comment) => comment.id), ["one", "three"]);
});

test("filters comments to authors with a website", () => {
  assert.deepEqual(filterComments(comments, "", "withWebsite").map((comment) => comment.id), ["one"]);
});

test("recent filter keeps the last thirty days and sorts newest first", () => {
  assert.deepEqual(filterComments(comments, "", "recent", Date.parse("2026-08-26T00:00:00Z")).map((comment) => comment.id), ["hidden", "three", "one"]);
});

test("hidden comments remain in the thread but do not match search or website filters", () => {
  assert.deepEqual(filterComments(comments, "hidden keyword", "all").map((comment) => comment.id), []);
  assert.deepEqual(filterComments(comments, "", "withWebsite").map((comment) => comment.id), ["one"]);
  assert.deepEqual(filterComments(comments, "", "all").map((comment) => comment.id), ["one", "two", "three", "hidden"]);
});
