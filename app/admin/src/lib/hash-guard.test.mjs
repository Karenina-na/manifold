import assert from "node:assert/strict";
import test from "node:test";

import { decideHashChange, hashChangeIsMarked, normaliseHash } from "./hash-guard.ts";

const base = { next: "#/media", applied: "#/writings/1", marked: false, dirty: true, canConfirm: true };

test("applies a hashchange this module performed", () => {
  const decision = decideHashChange({ ...base, marked: true });
  assert.deepEqual(decision, { action: "apply" }, "our own write is already decided and must not be re-prompted");
});

// The defect this guards: a back/forward gesture unmounts the editor and takes
// the unsaved work with it, and beforeunload never fires for an in-page hash
// change, so nothing else would have asked.
test("refuses a back/forward gesture while an editor is dirty", () => {
  const decision = decideHashChange(base);
  assert.deepEqual(
    decision,
    { action: "refuse", attempted: "#/media" },
    "a dirty editor must be able to hand the attempted target to the confirm modal",
  );
});

test("applies a back/forward gesture when nothing is dirty", () => {
  const decision = decideHashChange({ ...base, dirty: false });
  assert.deepEqual(decision, { action: "apply" });
});

// Mirrors requestNavigate, which navigates freely with no confirm handler
// registered. Refusing here would strand the URL on a target the UI never
// rendered, with no way to ask the user about it.
test("applies rather than refusing when no confirm handler is registered", () => {
  const decision = decideHashChange({ ...base, canConfirm: false });
  assert.deepEqual(decision, { action: "apply" });
});

test("ignores a hashchange that does not move the hash", () => {
  const decision = decideHashChange({ ...base, next: "#/writings/1" });
  assert.deepEqual(decision, { action: "ignore" }, "a same-hash event must not re-render the route");
});

// A write to the hash that is already there fires no event at all, so a mark
// left over from it would otherwise be consumed by the next genuine gesture.
test("only honours a mark that matches the event's hash", () => {
  assert.equal(hashChangeIsMarked("#/media", "#/media"), true);
  assert.equal(hashChangeIsMarked("#/media", "#/writings/1"), false, "a stale mark must not apply the event");
  assert.equal(hashChangeIsMarked(null, "#/media"), false);
});

test("normalises targets with and without a leading hash", () => {
  assert.equal(normaliseHash("#/media"), "#/media");
  assert.equal(normaliseHash("/media"), "#/media");
  assert.equal(normaliseHash("#/thoughts/1?page=2"), "#/thoughts/1?page=2");
});
