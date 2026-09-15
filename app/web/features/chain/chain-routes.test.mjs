import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appRoot = new URL("../../app/chain/", import.meta.url);

test("chain uses a compact landing page with separate explorer and tools routes", () => {
  const landing = fs.readFileSync(new URL("page.tsx", appRoot), "utf8");
  const explorer = fs.readFileSync(new URL("explorer/page.tsx", appRoot), "utf8");
  const tools = fs.readFileSync(new URL("tools/page.tsx", appRoot), "utf8");
  const overview = fs.readFileSync(new URL("../../features/chain/chain-overview.tsx", import.meta.url), "utf8");
  const explorerFeature = fs.readFileSync(new URL("../../features/chain/chain-explorer.tsx", import.meta.url), "utf8");
  const toolsFeature = fs.readFileSync(new URL("../../features/chain/chain-tools.tsx", import.meta.url), "utf8");
  const anchorBadge = fs.readFileSync(new URL("../../features/content/anchor-badge.tsx", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("../../app/site.module.css", import.meta.url), "utf8");

  assert.match(landing, /ChainOverview/);
  assert.doesNotMatch(landing, /ChainExplorer/);
  assert.doesNotMatch(overview, /chainOverviewIntro|chain\.overviewIntro/);
  assert.match(explorer, /ChainExplorer/);
  assert.match(tools, /ChainTools/);
  for (const route of [explorer, tools]) {
    assert.match(route, /<BackLink href="\/chain" label=\{t\("chain\.backToChain"\)\} canGoBack=\{false\} \/>/);
    assert.doesNotMatch(route, /headers\(\)|router\.back\(\)/);
  }
  assert.match(styles, /\.chainExplorerDetail[^\n]*position: sticky; top: 88px;/);
  assert.match(styles, /\.chainVerifyRight[^\n]*position: sticky; top: 88px;/);
  assert.match(styles, /\.chainGraphCompRow[^\n]*grid-template-columns: 22px minmax\(0, 2fr\) auto minmax\(0, 1fr\);/);
  assert.match(styles, /\.chainGraphCompExpr, \.chainGraphCompVal[^\n]*min-width: 0;/);
  assert.match(styles, /:global\(main \.articleBack a\), \.chainBack a, \.chainDetailBack \{/);
  assert.match(explorerFeature, /<ArrowLeft size=\{15\} aria-hidden="true" \/>/);
  assert.match(explorerFeature, /readExplorerState/);
  assert.match(explorerFeature, /chainAnchors/);
  assert.doesNotMatch(explorerFeature, /usePendingCommits/);
  assert.match(toolsFeature, /usePendingCommits/);
  assert.match(toolsFeature, /verifyComment/);
  assert.match(anchorBadge, /explorerHref/);
  assert.match(anchorBadge, /toolsHref/);
});
