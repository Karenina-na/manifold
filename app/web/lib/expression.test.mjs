import assert from "node:assert/strict";
import test from "node:test";
import { evaluateArithmetic } from "./expression.ts";

test("evaluates the four operators with precedence", () => {
  assert.equal(evaluateArithmetic("1 + 2 * 3"), 7);
  assert.equal(evaluateArithmetic("(1 + 2) * 3"), 9);
  assert.equal(evaluateArithmetic("1024 / 4"), 256);
  assert.equal(evaluateArithmetic("7 % 3"), 1);
});

test("treats ^ and ** as right-associative exponentiation", () => {
  assert.equal(evaluateArithmetic("2^10"), 1024);
  assert.equal(evaluateArithmetic("2 ** 10"), 1024);
  assert.equal(evaluateArithmetic("2^3^2"), 512);
});

test("handles unary signs, including on the exponent", () => {
  assert.equal(evaluateArithmetic("-2^2"), -4);
  assert.equal(evaluateArithmetic("2^-2"), 0.25);
  assert.equal(evaluateArithmetic("--5"), 5);
  assert.equal(evaluateArithmetic("3 - -2"), 5);
});

test("accepts decimals and surrounding whitespace", () => {
  assert.equal(evaluateArithmetic(" 1.5 * 2 "), 3);
  assert.equal(evaluateArithmetic(".5 + .25"), 0.75);
});

test("rejects anything that is not arithmetic", () => {
  // The old implementation handed the expression to new Function(); these are
  // the shapes that must now fail as parse errors instead of executing.
  for (const source of ["", "   ", "1 +", "alert(1)", "process.exit()", "1;2", "2 3", "(1 + 2", "1 + 2)"]) {
    assert.throws(() => evaluateArithmetic(source), `expected ${JSON.stringify(source)} to be rejected`);
  }
});

test("rejects division by zero and non-finite results", () => {
  assert.throws(() => evaluateArithmetic("1 / 0"));
  assert.throws(() => evaluateArithmetic("1 % 0"));
  assert.throws(() => evaluateArithmetic("9^9^9"));
});
