import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { normalizeTheme, THEME_EVENT, THEME_STORAGE_KEY, themeInitScript } from "./theme.ts";

// Runs the inline theme script the way a browser would: as a bare script with
// `localStorage` and `document` already in scope. This is the behaviour that
// keeps a dark-mode reader from seeing the light palette on first paint, so it
// is worth executing rather than merely matching against.
function runThemeInitScript(storage) {
  const documentElement = { dataset: {} };
  const context = vm.createContext({
    document: { documentElement },
    localStorage: { getItem: (key) => (key in storage ? storage[key] : null) },
  });
  vm.runInContext(themeInitScript, context);
  return documentElement.dataset.theme;
}

test("normalises any stored value to one of the two themes", () => {
  assert.equal(normalizeTheme("dark"), "dark");
  assert.equal(normalizeTheme("light"), "light");
  assert.equal(normalizeTheme(null), "light");
  assert.equal(normalizeTheme(undefined), "light");
  assert.equal(normalizeTheme("solarized"), "light");
});

test("the inline script paints the stored theme before the app bundle runs", () => {
  assert.equal(runThemeInitScript({ [THEME_STORAGE_KEY]: "dark" }), "dark");
  assert.equal(runThemeInitScript({ [THEME_STORAGE_KEY]: "light" }), "light");
  assert.equal(runThemeInitScript({}), "light");
  assert.equal(runThemeInitScript({ [THEME_STORAGE_KEY]: "solarized" }), "light");
});

test("the inline script survives a storage read that throws", () => {
  const documentElement = { dataset: {} };
  const context = vm.createContext({
    document: { documentElement },
    localStorage: { getItem: () => { throw new Error("SecurityError"); } },
  });
  vm.runInContext(themeInitScript, context);
  assert.equal(documentElement.dataset.theme, "light");
});

test("the inline script reads the same key the provider writes", () => {
  assert.ok(themeInitScript.includes(JSON.stringify(THEME_STORAGE_KEY)));
  assert.equal(THEME_STORAGE_KEY, "manifold.theme");
  assert.equal(THEME_EVENT, "manifold:theme");
});
