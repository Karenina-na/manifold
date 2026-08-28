import assert from "node:assert/strict";
import test from "node:test";
import { orderSelectedFirst } from "./tag-order.ts";

test("moves selected tags to the front and preserves tag-list order", () => {
  const tags = [{ name: "go" }, { name: "design" }, { name: "sqlite" }];
  assert.deepEqual(orderSelectedFirst(tags, ["sqlite", "go"]), [{ name: "go" }, { name: "sqlite" }, { name: "design" }]);
});

test("keeps the original order when nothing is selected", () => {
  const tags = [{ name: "go" }, { name: "design" }];
  assert.deepEqual(orderSelectedFirst(tags, []), tags);
});

test("ignores selected names that are not part of the tag list", () => {
  const tags = [{ name: "go" }, { name: "design" }];
  assert.deepEqual(orderSelectedFirst(tags, ["missing", "design"]), [{ name: "design" }, { name: "go" }]);
});
