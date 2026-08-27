type PreviewContent = { summary?: string | null; excerpt?: string | null; body?: string | null };

export function previewForContent(item: PreviewContent) {
  return {
    summary: item.summary?.trim() ?? "",
    excerpt: item.excerpt?.trim() || item.body?.trim() || "",
  };
}
