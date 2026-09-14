import type { AnchorSource } from "@manifold/contracts";

export type ExplorerTab = "blocks" | "anchors";
export type ToolsTab = "verify" | "submit";

export type ExplorerState = {
  tab: ExplorerTab;
  page: number;
  source: AnchorSource | null;
  ref: string | null;
  blockId: string | null;
  anchorId: string | null;
};

const ANCHOR_SOURCES: AnchorSource[] = ["content", "comment", "reaction", "profile", "site", "media", "auth", "visitor", "admin"];

export function readExplorerState(params: URLSearchParams): ExplorerState {
  const tab: ExplorerTab = params.get("tab") === "anchors" ? "anchors" : "blocks";
  const source = readSource(params.get("source"));
  const ref = readText(params.get("ref"));
  const page = readPage(params.get("page"));
  return {
    tab,
    page,
    source,
    ref,
    blockId: tab === "blocks" ? readIdentifier(params.get("block"), "block_") : null,
    anchorId: tab === "anchors" ? readIdentifier(params.get("anchor"), "cert_") : null,
  };
}

export function explorerHref(state: Partial<ExplorerState> = {}): string {
  const tab: ExplorerTab = state.tab === "anchors" ? "anchors" : "blocks";
  const params = new URLSearchParams();
  if (state.tab) params.set("tab", tab);
  if (state.source) params.set("source", state.source);
  if (state.ref) params.set("ref", state.ref);
  if (state.page && state.page > 1) params.set("page", String(Math.floor(state.page)));
  if (tab === "blocks" && state.blockId) params.set("block", state.blockId);
  if (tab === "anchors" && state.anchorId) params.set("anchor", state.anchorId);
  const query = params.toString();
  return query ? `/chain/explorer?${query}` : "/chain/explorer";
}

export function legacyChainHref(params: URLSearchParams): string | null {
  const blockId = readIdentifier(params.get("block"), "block_");
  if (blockId) return explorerHref({ tab: "blocks", blockId });
  const page = readPage(params.get("page"));
  if (params.get("page") && page > 1) return explorerHref({ tab: "blocks", page });
  return null;
}

export function readToolsTab(params: URLSearchParams): ToolsTab {
  return params.get("tab") === "submit" ? "submit" : "verify";
}

export function toolsHref(tab: ToolsTab = "verify"): string {
  return tab === "submit" ? "/chain/tools?tab=submit" : "/chain/tools";
}

function readPage(value: string | null): number {
  const page = Number.parseInt(value ?? "", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function readSource(value: string | null): AnchorSource | null {
  return value && ANCHOR_SOURCES.includes(value as AnchorSource) ? value as AnchorSource : null;
}

function readText(value: string | null): string | null {
  const text = value?.trim().slice(0, 200) ?? "";
  return text || null;
}

function readIdentifier(value: string | null, prefix: string): string | null {
  if (!value || !value.startsWith(prefix)) return null;
  return /^[a-zA-Z0-9_-]+$/.test(value) ? value : null;
}
