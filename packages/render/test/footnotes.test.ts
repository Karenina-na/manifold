import assert from "node:assert/strict";
import test from "node:test";
import { remarkFootnotes } from "../src/footnotes.ts";
import type { MdNode } from "../src/mdast.ts";

// The mdast shape micromark/remark-gfm hands to the plugin: definitions are
// block nodes carrying a paragraph, references are inline nodes.
const definition = (id: string, text: string): MdNode => ({
  type: "footnoteDefinition",
  identifier: id,
  label: id,
  children: [{ type: "paragraph", children: [{ type: "text", value: text }] }],
});
const reference = (id: string): MdNode => ({ type: "footnoteReference", identifier: id, label: id });
const paragraph = (...children: MdNode[]): MdNode => ({ type: "paragraph", children });

const run = (children: MdNode[]) => {
  const tree: MdNode = { type: "root", children };
  remarkFootnotes()(tree);
  return tree;
};

const htmlOf = (tree: MdNode) => tree.children?.find((child) => child.type === "html")?.value ?? "";

test("consecutive definitions are all collected and none leak into the body", () => {
  const tree = run([
    paragraph({ type: "text", value: "a" }, reference("1"), { type: "text", value: "b" }, reference("2")),
    definition("1", "one"),
    definition("2", "two"),
  ]);
  assert.deepEqual(tree.children?.map((child) => child.type), ["paragraph", "html"]);
  const section = htmlOf(tree);
  assert.match(section, /<li id="fn-1"><p>one /);
  assert.match(section, /<li id="fn-2"><p>two /);
});

test("references are numbered by definition order, not by the written identifier", () => {
  // [^2] is cited first but defined second, so it reads as note 2 — the same
  // number vditor/lute shows inside the admin editor.
  const tree = run([paragraph(reference("2"), reference("1")), definition("1", "one"), definition("2", "two")]);
  const markers = (tree.children?.[0]?.children ?? []).filter((child) => child.type === "html").map((child) => child.value);
  assert.equal(markers.length, 2);
  assert.match(markers[0] ?? "", /href="#fn-2" id="fnref-2" data-footnote-ref>2</);
  assert.match(markers[1] ?? "", /href="#fn-1" id="fnref-1" data-footnote-ref>1</);
});

test("named and gapped identifiers still render as plain sequential numbers", () => {
  const tree = run([paragraph(reference("note"), reference("7")), definition("note", "first"), definition("7", "second")]);
  const markers = (tree.children?.[0]?.children ?? []).filter((child) => child.type === "html").map((child) => child.value);
  assert.match(markers[0] ?? "", /href="#fn-1" id="fnref-1" data-footnote-ref>1</);
  assert.match(markers[1] ?? "", /href="#fn-2" id="fnref-2" data-footnote-ref>2</);
  assert.match(htmlOf(tree), /<li id="fn-1"><p>first /);
  assert.match(htmlOf(tree), /<li id="fn-2"><p>second /);
});

test("a repeated reference gets one number and unique anchor ids", () => {
  const tree = run([paragraph(reference("1"), reference("1")), definition("1", "one")]);
  const markers = (tree.children?.[0]?.children ?? []).filter((child) => child.type === "html").map((child) => child.value);
  assert.match(markers[0] ?? "", /id="fnref-1"/);
  assert.match(markers[1] ?? "", /id="fnref-1-2"/);
  const backrefs = htmlOf(tree).match(/data-footnote-backref/g) ?? [];
  assert.equal(backrefs.length, 2);
  assert.match(htmlOf(tree), /href="#fnref-1"/);
  assert.match(htmlOf(tree), /href="#fnref-1-2"/);
});

test("an unreferenced definition keeps its slot without a back-reference", () => {
  const tree = run([paragraph(reference("2")), definition("1", "unused"), definition("2", "used")]);
  const section = htmlOf(tree);
  assert.match(section, /<li id="fn-1"><p>unused<\/p><\/li>/);
  assert.match(section, /<li id="fn-2"><p>used /);
  assert.equal((section.match(/data-footnote-backref/g) ?? []).length, 1);
});

test("note text is escaped in both the popover and the definition list", () => {
  const tree = run([paragraph(reference("x")), definition("x", 'a & b <script>"x"</script>')]);
  const marker = (tree.children?.[0]?.children ?? []).find((child) => child.type === "html")?.value ?? "";
  assert.match(marker, /a &amp; b &lt;script&gt;&quot;x&quot;&lt;\/script&gt;/);
  assert.match(htmlOf(tree), /a &amp; b &lt;script&gt;/);
});

test("content without footnotes gains no footnote section", () => {
  const tree = run([paragraph({ type: "text", value: "plain" })]);
  assert.deepEqual(tree.children?.map((child) => child.type), ["paragraph"]);
});
