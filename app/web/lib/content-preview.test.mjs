import assert from "node:assert/strict";
import test from "node:test";
import { previewForContent } from "./content-preview.ts";

test("keeps summary and body excerpt as distinct preview fields", () => {
  assert.deepEqual(previewForContent({ summary: "  Why it matters. ", excerpt: "  The body starts here. " }), {
    summary: "Why it matters.",
    excerpt: "The body starts here.",
  });
});

test("falls back to an available body when older Core responses omit excerpt", () => {
  assert.deepEqual(previewForContent({ summary: "Summary", body: "Body fallback" }), {
    summary: "Summary",
    excerpt: "Body fallback",
  });
});

test("falls back to body when an excerpt is present but empty", () => {
  assert.deepEqual(previewForContent({ summary: "Summary", excerpt: "", body: "Body fallback" }), {
    summary: "Summary",
    excerpt: "Body fallback",
  });
});
