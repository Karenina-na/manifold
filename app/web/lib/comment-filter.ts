import type { Comment } from "@manifold/contracts";

export type CommentFilter = "all" | "withWebsite" | "recent";

const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function filterComments(comments: Comment[], search: string, filter: CommentFilter, now = Date.now()): Comment[] {
  const needle = search.trim().toLocaleLowerCase();
  const filtered = comments.filter((comment) => {
    const matchesSearch = !needle || `${comment.authorName} ${comment.body}`.toLocaleLowerCase().includes(needle);
    if (!matchesSearch) return false;
    if (filter === "withWebsite") return Boolean(comment.authorUrl);
    if (filter === "recent") {
      const createdAt = Date.parse(comment.createdAt);
      return !Number.isNaN(createdAt) && createdAt >= now - RECENT_WINDOW_MS;
    }
    return true;
  });
  return filter === "recent"
    ? filtered.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    : filtered;
}
