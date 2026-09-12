import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { API_ERROR_CODES, isApiErrorCode } from "../src/index.ts";

// The Go half of the error-code contract. It is parsed rather than imported
// because the two halves are written in different languages, and the whole
// point of this test is to fail loudly the moment one side adds, renames or
// drops a code — a silent drift there is exactly what lets a client-side
// `switch (error.code)` branch rot without anyone noticing.
const codesGoPath = fileURLToPath(new URL("../../../app/core/internal/apierror/codes.go", import.meta.url));

function goCodes(): string[] {
  const source = readFileSync(codesGoPath, "utf8");
  return [...source.matchAll(/^\t[A-Za-z0-9]+\s+=\s+"([A-Z0-9_]+)"$/gm)].map((match) => match[1]);
}

test("the Go and TypeScript error-code lists are identical", () => {
  const go = goCodes();
  assert.ok(go.length > 0, `no codes parsed from ${codesGoPath}`);
  assert.equal(new Set(go).size, go.length, "codes.go declares the same code twice");
  assert.equal(new Set(API_ERROR_CODES).size, API_ERROR_CODES.length, "API_ERROR_CODES lists the same code twice");
  assert.deepEqual([...go].sort(), [...API_ERROR_CODES].sort());
});

test("every modelled code has the wire shape and is accepted by the guard", () => {
  for (const code of API_ERROR_CODES) {
    assert.match(code, /^[A-Z][A-Z0-9_]*$/, `${code} is not SCREAMING_SNAKE_CASE`);
    assert.equal(isApiErrorCode(code), true);
  }
  for (const rejected of ["NOT_A_CODE", "validation_error", "", "REQUEST_FAILED", 42, undefined, null, {}]) {
    assert.equal(isApiErrorCode(rejected), false, `${String(rejected)} must not be accepted`);
  }
});

// REQUEST_FAILED is the SDK's own fallback for an unparseable error body, so it
// is deliberately absent from the Core list: the two sets must stay disjoint.
test("the SDK fallback code is not part of the Core contract", () => {
  assert.equal(API_ERROR_CODES.includes("REQUEST_FAILED" as never), false);
});
