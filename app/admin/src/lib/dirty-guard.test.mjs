import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

// `dirty-guard.ts` registers its `beforeunload` listener at module scope, so the
// fake `window` has to exist before the module is evaluated — hence the dynamic
// import instead of a static one.
const listeners = [];
globalThis.window = { addEventListener: (type, handler) => listeners.push([type, handler]) };

const { beforeUnloadHandler, hasUnsavedChanges, setDirtyGuard } = await import("./dirty-guard.ts");

test.afterEach(() => setDirtyGuard(null));

function fakeEvent() {
  const event = { preventDefault: () => { event.prevented += 1; }, prevented: 0, returnValue: "untouched" };
  return event;
}

test("registers a beforeunload listener when the module is loaded", () => {
  assert.equal(listeners.length, 1, "the guard must install exactly one listener");
  assert.equal(listeners[0][0], "beforeunload");
  assert.equal(typeof listeners[0][1], "function");
});

test("reports no unsaved changes until a workspace registers a guard", () => {
  assert.equal(hasUnsavedChanges(), false);
  setDirtyGuard(() => true);
  assert.equal(hasUnsavedChanges(), true);
  setDirtyGuard(() => false);
  assert.equal(hasUnsavedChanges(), false);
  setDirtyGuard(null);
  assert.equal(hasUnsavedChanges(), false);
});

test("lets the browser leave when nothing is dirty", () => {
  const event = fakeEvent();
  beforeUnloadHandler(event);
  assert.equal(event.prevented, 0, "a clean editor must not block navigation");
  assert.equal(event.returnValue, "untouched", "the handler must not touch returnValue");
});

test("asks the browser to confirm before discarding unsaved work", () => {
  setDirtyGuard(() => true);
  const event = fakeEvent();
  beforeUnloadHandler(event);
  assert.equal(event.prevented, 1, "an armed guard must call preventDefault");
  assert.equal(event.returnValue, "", "returnValue is written for engines that still read it");
});

test("the registered listener consults the live guard, not a snapshot", () => {
  const registered = listeners[0][1];
  const clean = fakeEvent();
  registered(clean);
  assert.equal(clean.prevented, 0);

  setDirtyGuard(() => true);
  const dirty = fakeEvent();
  registered(dirty);
  assert.equal(dirty.prevented, 1, "registering after mount must still arm the listener");
});

// The guard is only as good as its registrations: a workspace that renders an
// "Unsaved changes" save bar but never calls `setDirtyGuard` is invisible to
// both `requestNavigate` and the `beforeunload` listener. Every such file reads
// `formState.isDirty` (the form instance is `form`, `profileForm`, …), so the
// sweep keys on that rather than on a single instance name.
const owners = [];
const collect = (dir) => {
  for (const entry of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
    if (entry.isDirectory()) collect(`${dir}${entry.name}/`);
    else if (entry.name.endsWith(".tsx")) {
      const source = readFileSync(new URL(`${dir}${entry.name}`, import.meta.url), "utf8");
      if (source.includes("formState.isDirty")) owners.push([`${dir}${entry.name}`, source]);
    }
  }
};
collect("../");

// Listed explicitly so that renaming a form instance cannot quietly drop a file
// out of the sweep and leave this test passing while asserting nothing about it.
const expected = [
  "../features/settings/AgentSettingsSection.tsx",
  "../features/settings/SettingsWorkspace.tsx",
  "../workspaces/ProfileWorkspace.tsx",
  "../workspaces/ThoughtsWorkspace.tsx",
  "../workspaces/WritingsWorkspace.tsx",
];

test("every workspace that owns a dirty form registers the guard", () => {
  const found = owners.map(([name]) => name);
  for (const name of expected) {
    assert.ok(found.includes(name), `${name} owns a dirty form and must be covered by the sweep`);
  }
  assert.deepEqual(
    found.filter((name) => !expected.includes(name)),
    [],
    "a new dirty-form owner appeared; add it to `expected` and make sure it registers the guard",
  );
  for (const [name, source] of owners) {
    if (name.endsWith("AgentSettingsSection.tsx")) {
      assert.match(source, /onDirtyChange\(form\.formState\.isDirty\)/, `${name} must report dirty state to its owning workspace`);
      assert.match(source, /return \(\) => onDirtyChange\(false\)/, `${name} must clear delegated dirty state on unmount`);
    } else {
      assert.match(source, /setDirtyGuard\(\(\) => dirtyRef\.current\)/, `${name} must register the dirty guard`);
      assert.match(source, /return \(\) => setDirtyGuard\(null\)/, `${name} must clear the guard on unmount`);
    }
  }
});
