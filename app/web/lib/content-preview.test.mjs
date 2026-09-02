import assert from "node:assert/strict";
import test from "node:test";
import { previewForContent } from "./content-preview.ts";

test("keeps summary and body excerpt as distinct preview fields", () => {
  assert.deepEqual(previewForContent({ summary: "  Why it matters. ", excerpt: "  The body starts here. " }), {
    summary: "Why it matters.",
    excerpt: "The body starts here.",
  });
});

test("keeps the Core excerpt authoritative when empty", () => {
  assert.deepEqual(previewForContent({ summary: "Summary", excerpt: "" }), {
    summary: "Summary",
    excerpt: "",
  });
});
