export type ArchiveFilterState = { query: string; tags: string[]; page: number };
export type ArchiveExtraParams = Record<string, string | undefined>;

export function serializeArchiveParams(state: ArchiveFilterState, extra: ArchiveExtraParams = {}) {
  const params = new URLSearchParams();
  const query = state.query.trim();
  if (query) params.set("q", query);
  for (const tag of state.tags) {
    const normalized = tag.trim();
    if (normalized) params.append("tag", normalized);
  }
  if (state.page > 1) params.set("page", String(state.page));
  for (const [key, value] of Object.entries(extra)) {
    const normalized = value?.trim();
    if (normalized) params.set(key, normalized);
  }
  return params.toString();
}

export function archiveHref(basePath: string, state: ArchiveFilterState, extra: ArchiveExtraParams = {}) {
  const serialized = serializeArchiveParams(state, extra);
  return serialized ? `${basePath}?${serialized}` : basePath;
}

export function clampPage(page: number, totalPages: number) {
  return Math.min(Math.max(1, page), Math.max(1, totalPages));
}
