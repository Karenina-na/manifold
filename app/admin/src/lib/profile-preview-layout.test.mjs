import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appStyles = readFileSync(new URL("../app/App.css", import.meta.url), "utf8");

test("profile preview keeps the program and institution columns shrinkable", () => {
  const previewLine = appStyles.match(/\.preview-line\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(
    previewLine,
    /grid-template-columns:\s*64px\s+minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/,
    "the two text columns must share the available preview width",
  );

  const textColumns = appStyles.match(/\.preview-line\s+strong,\s*\.preview-line\s+em\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(textColumns, /min-width:\s*0/);
  assert.match(textColumns, /overflow-wrap:\s*anywhere/);
});
