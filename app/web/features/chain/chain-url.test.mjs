import assert from "node:assert/strict";
import test from "node:test";
import {
  explorerHref,
  legacyChainHref,
  readExplorerState,
  readToolsState,
  readToolsTab,
  toolsHref,
} from "./chain-url.ts";

test("reads explorer tabs, filters, pagination, and one selected detail", () => {
  const state = readExplorerState(new URLSearchParams("tab=anchors&source=content&ref=content_1&page=3&anchor=cert_1"));

  assert.deepEqual(state, {
    tab: "anchors",
    page: 3,
    source: "content",
    ref: "content_1",
    blockId: null,
    anchorId: "cert_1",
  });
});

test("normalizes invalid explorer state to safe defaults", () => {
  assert.deepEqual(readExplorerState(new URLSearchParams("tab=unknown&page=0&source=unknown&block=block_2&anchor=cert_2")), {
    tab: "blocks",
    page: 1,
    source: null,
    ref: null,
    blockId: "block_2",
    anchorId: null,
  });
});

test("serializes explorer state without default query noise", () => {
  assert.equal(explorerHref({}), "/chain/explorer");
  assert.equal(explorerHref({ tab: "anchors", source: "comment", page: 2, anchorId: "cert_2" }), "/chain/explorer?tab=anchors&source=comment&page=2&anchor=cert_2");
});

test("maps legacy chain deep links into the explorer", () => {
  assert.equal(legacyChainHref(new URLSearchParams("block=block_7")), "/chain/explorer?tab=blocks&block=block_7");
  assert.equal(legacyChainHref(new URLSearchParams("page=4")), "/chain/explorer?tab=blocks&page=4");
  assert.equal(legacyChainHref(new URLSearchParams("")), null);
});

test("keeps tools tab state explicit and defaults to verification", () => {
  assert.equal(readToolsTab(new URLSearchParams("tab=submit")), "submit");
  assert.equal(readToolsTab(new URLSearchParams("tab=unknown")), "verify");
  assert.deepEqual(readToolsState(new URLSearchParams("mode=comment&value=comment_1")), { tab: "verify", mode: "comment", value: "comment_1" });
  assert.equal(toolsHref(), "/chain/tools");
  assert.equal(toolsHref("submit"), "/chain/tools?tab=submit");
  assert.equal(toolsHref("verify", { mode: "hash", value: "abc123" }), "/chain/tools?mode=hash&value=abc123");
});
