import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { inlineScriptHash, inlineScriptJSON, requestIsSecure } from "./security.ts";

test("escapes the characters that can break out of an inline script element", () => {
  // The regression this guards: manifold_oauth_return is attacker-controlled
  // through the login query string, and an unescaped "</script>" would end the
  // callback page's script block and let the rest of the value run as markup.
  const serialized = inlineScriptJSON("/</script><script>alert(1)</script>");
  assert.equal(serialized.includes("</script>"), false);
  assert.equal(serialized.includes("<"), false);
  assert.equal(serialized, String.raw`"/\u003c/script\u003e\u003cscript\u003ealert(1)\u003c/script\u003e"`);
});

test("keeps the decoded value identical to the input", () => {
  const value = "/writing/flow?q=a&b<c>d\u2028e\u2029f";
  assert.equal(JSON.parse(inlineScriptJSON(value)), value);
});

test("leaves ordinary values untouched apart from quoting", () => {
  assert.equal(inlineScriptJSON("/"), String.raw`"/"`);
  assert.equal(inlineScriptJSON("/writing/go-modules"), String.raw`"/writing/go-modules"`);
});

test("pins an inline script by the sha256 of its exact source", () => {
  const source = "var a = 1;";
  const expected = createHash("sha256").update(source, "utf8").digest("base64");
  assert.equal(inlineScriptHash(source), `'sha256-${expected}'`);
});

test("prefers x-forwarded-proto when a proxy terminates TLS", () => {
  assert.equal(requestIsSecure("http:", "https"), true);
  assert.equal(requestIsSecure("http:", "https, http"), true);
  assert.equal(requestIsSecure("https:", "http"), false);
});

test("falls back to the request protocol without a forwarded header", () => {
  assert.equal(requestIsSecure("https:", null), true);
  assert.equal(requestIsSecure("https:", undefined), true);
  assert.equal(requestIsSecure("http:", null), false);
  assert.equal(requestIsSecure("HTTP:", ""), false);
});
