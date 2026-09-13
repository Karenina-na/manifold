import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FOCUSABLE_SELECTOR, focusWrapTarget } from "./modal-focus.ts";

// The two modal surfaces (image lightbox, search dialog) contain different
// numbers of controls, so every shape gets its own case rather than trusting one
// representative example.
test("leaves Tab alone when the container has no focusable element", () => {
  assert.equal(focusWrapTarget([], "anything", false), null);
  assert.equal(focusWrapTarget([], null, true), null);
});

test("keeps Tab on the only control in a single-control dialog", () => {
  assert.equal(focusWrapTarget(["close"], "close", false), "close");
  assert.equal(focusWrapTarget(["close"], "close", true), "close");
  assert.equal(focusWrapTarget(["close"], null, false), "close");
});

test("wraps forward from the last control to the first", () => {
  const controls = ["close", "input", "result"];
  assert.equal(focusWrapTarget(controls, "result", false), "close");
});

test("wraps backward from the first control to the last", () => {
  const controls = ["close", "input", "result"];
  assert.equal(focusWrapTarget(controls, "close", true), "result");
});

test("does not intercept Tab in the middle of the tab order", () => {
  const controls = ["close", "input", "result"];
  assert.equal(focusWrapTarget(controls, "input", false), null, "the browser already moves to the next control");
  assert.equal(focusWrapTarget(controls, "input", true), null, "the browser already moves to the previous control");
});

test("pulls focus back in when it starts outside the container", () => {
  const controls = ["close", "input", "result"];
  assert.equal(focusWrapTarget(controls, "body", false), "close");
  assert.equal(focusWrapTarget(controls, "body", true), "result");
  assert.equal(focusWrapTarget(controls, null, false), "close");
  assert.equal(focusWrapTarget(controls, null, true), "result");
});

test("the queried selector covers the controls these dialogs actually render", () => {
  assert.match(FOCUSABLE_SELECTOR, /a\[href\]/, "search results are links");
  assert.match(FOCUSABLE_SELECTOR, /button:not\(\[disabled\]\)/, "the close button is a button");
  assert.match(FOCUSABLE_SELECTOR, /input:not\(\[disabled\]\)/, "the search field is an input");
  assert.doesNotMatch(FOCUSABLE_SELECTOR, /disabled\)\s*:\s*not/, "disabled controls must stay out of the tab order");
});

// Both `aria-modal="true"` surfaces must actually use the boundary; a new modal
// that forgets it would reintroduce the defect the review found.
test("every modal surface routes through the shared focus boundary", () => {
  for (const path of ["../../features/content/article-lightbox.tsx", "../layout/site-nav.tsx"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /aria-modal="true"/, `${path} declares a modal dialog`);
    assert.match(source, /useModalFocus\(/, `${path} must trap and restore focus`);
  }
  const tooltip = readFileSync(new URL("./floating-tooltip.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(tooltip, /aria-modal/, "the tooltip is not a modal and must not trap focus");
});
