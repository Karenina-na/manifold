import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = await readFile(resolve(here, "../app/writing/[slug]/page.tsx"), "utf8");
const stylesSource = await readFile(resolve(here, "../app/site.module.css"), "utf8");
const readingShellSource = await readFile(resolve(here, "../components/article-reading-shell.tsx"), "utf8");

test("writing detail keeps the back link outside the title surface", () => {
  const backIndex = pageSource.indexOf('<div className={styles.articleBack}>');
  const titleIndex = pageSource.indexOf('<section className={styles.articleTitleBlock}>');

  assert.notEqual(backIndex, -1, "writing detail should render a back link");
  assert.notEqual(titleIndex, -1, "writing detail should render a title block");
  assert.ok(backIndex < titleIndex, "the back link should be rendered before the title block");
});

test("writing detail keeps the title surfaces aligned before the three-column layout fits", () => {
  assert.match(stylesSource, /\.articleBack \{ width: min\(860px, calc\(100% - 434px\)\);/);
  assert.match(stylesSource, /\.articleTitleBlock \{ width: min\(860px, calc\(100% - 434px\)\);/);
  assert.match(stylesSource, /@media \(max-width: 1300px\)/);
  assert.match(stylesSource, /\.articleBack, \.articleTitleBlock \{ width: min\(760px, calc\(100% - 172px\)\);/);
});

test("article end state observes discussion layout changes", () => {
  assert.match(readingShellSource, /new ResizeObserver\(scheduleUpdate\)/);
  assert.match(readingShellSource, /resizeObserver\?\.disconnect\(\)/);
});
