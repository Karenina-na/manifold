export type RawSearchParams = Record<string, string | string[] | undefined>;

export function readSearchParam(params: RawSearchParams, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value.trim() : "";
}

export function readSearchText(params: RawSearchParams, key: string, maxLength: number): string {
  return readSearchParam(params, key).slice(0, maxLength);
}

export function readSearchPage(params: RawSearchParams): number {
  return Math.max(1, Number.parseInt(readSearchParam(params, "page"), 10) || 1);
}
