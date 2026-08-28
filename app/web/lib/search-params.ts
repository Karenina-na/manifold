export type RawSearchParams = Record<string, string | string[] | undefined>;

export function readSearchParam(params: RawSearchParams, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value.trim() : "";
}

export function readSearchText(params: RawSearchParams, key: string, maxLength: number): string {
  return readSearchParam(params, key).slice(0, maxLength);
}

export function readSearchTags(params: RawSearchParams, key = "tag", maxTags = 10): string[] {
  const raw = params[key];
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const tags: string[] = [];
  for (const value of values) {
    for (const part of value.split(",")) {
      const tag = part.trim().slice(0, 80);
      if (!tag || tags.includes(tag) || tags.length >= maxTags) continue;
      tags.push(tag);
    }
  }
  return tags;
}

export function readSearchPage(params: RawSearchParams): number {
  return Math.max(1, Number.parseInt(readSearchParam(params, "page"), 10) || 1);
}
