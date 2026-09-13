import assert from "node:assert/strict";
import test from "node:test";
import { resolveArticleActionsAtEnd } from "./article-end-threshold.ts";

function resolve({ atEnd = false, previousScrollY = 0, scrollY = previousScrollY, triggerTop }) {
  return resolveArticleActionsAtEnd({ atEnd, previousScrollY, scrollY, triggerTop, activationLine: 684 });
}

test("keeps article actions in the side rail before the trigger reaches the activation line", () => {
  assert.equal(resolve({ triggerTop: 701 }), false);
});

test("moves article actions into the ending block at the activation line", () => {
  assert.equal(resolve({ triggerTop: 684 }), true);
});

test("keeps article actions in the ending block after the trigger passes above the viewport", () => {
  assert.equal(resolve({ atEnd: true, previousScrollY: 4100, scrollY: 4800, triggerTop: -120 }), true);
});

test("keeps article actions at the end when layout changes move the trigger below the line", () => {
  assert.equal(resolve({ atEnd: true, previousScrollY: 4800, scrollY: 4800, triggerTop: 701 }), true);
});

test("returns article actions to the side rail only after scrolling up past the line", () => {
  assert.equal(resolve({ atEnd: true, previousScrollY: 4800, scrollY: 3900, triggerTop: 701 }), false);
});
