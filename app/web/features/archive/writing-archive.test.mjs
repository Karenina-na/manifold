import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";

const siteStyles = await readFile(resolve(import.meta.dirname, "../../app/site.module.css"), "utf8");

test("separates writing rows with the same 13px rhythm as thought cards", () => {
  assert.match(siteStyles, /\.thoughtTimelineRow \{[^}]*padding-bottom: 13px;/);
  assert.match(siteStyles, /\.writingList \{[^}]*display: grid;[^}]*gap: 13px;/);
});
