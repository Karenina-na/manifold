import assert from "node:assert/strict";
import test from "node:test";
import { computeCenteredAsideOffset } from "./centered-aside.ts";

const base = { viewportHeight: 900, navClearance: 112 };

test("centers a fitting aside in the viewport at the current scroll position", () => {
  assert.equal(computeCenteredAsideOffset({ ...base, scrollTop: 0, slotTop: 100, slotHeight: 3000, asideHeight: 400 }), 150);
  assert.equal(computeCenteredAsideOffset({ ...base, scrollTop: 800, slotTop: 100, slotHeight: 3000, asideHeight: 400 }), 950);
});

test("keeps the aside below the nav clearance when it is nearly viewport tall", () => {
  assert.equal(computeCenteredAsideOffset({ ...base, scrollTop: 0, slotTop: 100, slotHeight: 3000, asideHeight: 820 }), 12);
  assert.equal(computeCenteredAsideOffset({ ...base, scrollTop: 500, slotTop: 100, slotHeight: 3000, asideHeight: 820 }), 512);
});

test("clamps the aside to the slot bounds and degenerates safely for short slots", () => {
  assert.equal(computeCenteredAsideOffset({ ...base, scrollTop: 0, slotTop: 500, slotHeight: 3000, asideHeight: 400 }), 0);
  assert.equal(computeCenteredAsideOffset({ ...base, scrollTop: 5000, slotTop: 100, slotHeight: 3000, asideHeight: 400 }), 2600);
  assert.equal(computeCenteredAsideOffset({ ...base, scrollTop: 200, slotTop: 100, slotHeight: 300, asideHeight: 400 }), 0);
});
