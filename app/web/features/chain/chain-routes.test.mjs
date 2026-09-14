import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appRoot = new URL("../../app/chain/", import.meta.url);

test("chain uses a compact landing page with separate explorer and tools routes", () => {
  const landing = fs.readFileSync(new URL("page.tsx", appRoot), "utf8");
  const explorer = fs.readFileSync(new URL("explorer/page.tsx", appRoot), "utf8");
  const tools = fs.readFileSync(new URL("tools/page.tsx", appRoot), "utf8");

  assert.match(landing, /ChainOverview/);
  assert.doesNotMatch(landing, /ChainExplorer/);
  assert.match(explorer, /ChainExplorer/);
  assert.match(tools, /ChainTools/);
});
