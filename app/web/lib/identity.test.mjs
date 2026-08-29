import assert from "node:assert/strict";
import test from "node:test";
import { generateName, hashSeed } from "./identity.ts";

test("generates a stable composed name from a seed", () => {
  const first = generateName("visitor-abc");
  const second = generateName("visitor-abc");
  assert.equal(first, second);
  assert.match(first, /^[a-z-]+-[0-9a-z]{2}$/);
});

test("generates different names for different seeds", () => {
  const names = new Set(Array.from({ length: 24 }, (_, index) => generateName(`visitor-${index}`)));
  assert.ok(names.size > 12);
});

test("hashes seeds deterministically", () => {
  assert.equal(hashSeed("seed"), hashSeed("seed"));
  assert.notEqual(hashSeed("seed"), hashSeed("seed-2"));
});
