import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Structural guards for the request fan-out fixes. They pin the shape of the
// code (memoised loaders, no second call site, no layout-level archive fetch)
// rather than counting requests, because the unit suite has no Core to count.
// A behavioural replacement belongs in scripts/browser-check.cjs.
const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFile(resolve(here, relative), "utf8");

const apiSource = await read("./api.ts");
const layoutSource = await read("../app/layout.tsx");
const writingSource = await read("../app/writing/[slug]/page.tsx");
const thoughtsSource = await read("../app/thoughts/[slug]/page.tsx");
const replSource = await read("../features/home/floating-repl.tsx");

test("per-request loaders are memoised so one render pass hits Core once", () => {
  assert.match(apiSource, /export const loadSiteData = cache\(/);
  assert.match(apiSource, /export const loadContentDetail = cache\(/);
});

test("detail pages resolve their content through the shared loader only", () => {
  for (const [name, source] of [["writing", writingSource], ["thoughts", thoughtsSource]]) {
    assert.doesNotMatch(source, /contentBySlug/, `${name} detail must not bypass the memoised loader`);
    const calls = source.match(/loadContentDetail\(/g) ?? [];
    assert.equal(calls.length, 2, `${name} detail resolves metadata and the page body from the same loader`);
  }
});

test("the root layout does not pull the archive on every route", () => {
  assert.doesNotMatch(layoutSource, /loadPapers/, "the layout must not fetch the article archive on every navigation");
  const propsBlock = replSource.slice(replSource.indexOf("type FloatingReplProps"), replSource.indexOf("const hostname"));
  assert.ok(propsBlock.length > 0, "the REPL props type should be discoverable");
  assert.doesNotMatch(propsBlock, /contents/, "the terminal must not receive the public archive as a prop");
  assert.match(replSource, /if \(!open \|\| contentsRequested\.current\) return/, "the terminal mounts the archive only after it opens");
  assert.match(replSource, /loadAllTerminalContent/, "the terminal mounts both public content kinds");
  assert.match(replSource, /client\.content\(\{ kind, page, pageSize: 100 \}\)/, "the terminal requests archive pages only from its lazy loader");
});
