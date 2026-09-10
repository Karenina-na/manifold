import assert from "node:assert/strict";
import test from "node:test";
import { clampCommentPage } from "../features/comments/use-comment-pagination.ts";

test("comment pagination clamps navigation to available pages", () => {
  assert.equal(clampCommentPage(0, 4), 1);
  assert.equal(clampCommentPage(3, 4), 3);
  assert.equal(clampCommentPage(8, 4), 4);
  assert.equal(clampCommentPage(2, 0), 1);
});
