type PreviewContent = { summary?: string | null; excerpt: string };

export function previewForContent(item: PreviewContent) {
  return {
    summary: item.summary?.trim() ?? "",
    excerpt: item.excerpt.trim(),
  };
}
