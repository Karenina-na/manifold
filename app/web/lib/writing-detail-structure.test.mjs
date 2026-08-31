import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = await readFile(resolve(here, "../app/writing/[slug]/page.tsx"), "utf8");
const renderSurfaceSource = await readFile(resolve(here, "../../../packages/render/src/content-surfaces.tsx"), "utf8");
const renderCssSource = await readFile(resolve(here, "../../../packages/render/src/render.css"), "utf8");
const readingShellSource = await readFile(resolve(here, "../components/article-reading-shell.tsx"), "utf8");

test("writing detail keeps the back link outside the title surface", () => {
  const backIndex = pageSource.indexOf('<div className="articleBack">');
  const shellIndex = pageSource.indexOf("<ArticleReadingShell");
  const titleIndex = renderSurfaceSource.indexOf('<section className="articleTitleBlock">');

  assert.notEqual(backIndex, -1, "writing detail should render a back link");
  assert.notEqual(shellIndex, -1, "writing detail should compose the shared reading shell");
  assert.notEqual(titleIndex, -1, "the shared surfaces should render a title block");
  assert.ok(backIndex < shellIndex, "the back link should be rendered before the reading shell");
});

test("writing detail keeps the title surfaces aligned before the three-column layout fits", () => {
  assert.ok(renderCssSource.includes(".articleBack, .articleTitleBlock { width: min(860px, calc(100% - 434px)); margin-left: 192px; margin-right: 0;"));
  assert.ok(renderCssSource.includes("@media (max-width: 1300px)"));
  assert.ok(renderCssSource.includes(".articleBack, .articleTitleBlock { width: min(760px, calc(100% - 172px)); margin-left: calc(172px + max(0px, calc((100% - 932px) / 2)));"));
});

test("article end state observes discussion layout changes", () => {
  assert.match(readingShellSource, /new ResizeObserver\(scheduleUpdate\)/);
  assert.match(readingShellSource, /resizeObserver\?\.disconnect\(\)/);
});
