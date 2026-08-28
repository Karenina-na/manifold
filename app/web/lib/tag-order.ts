export function orderSelectedFirst<T extends { name: string }>(tags: T[], selected: readonly string[]): T[] {
  const selectedSet = new Set(selected);
  return [...tags.filter((tag) => selectedSet.has(tag.name)), ...tags.filter((tag) => !selectedSet.has(tag.name))];
}
