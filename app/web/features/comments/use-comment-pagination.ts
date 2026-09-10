import { useCallback, useEffect, useState, type RefObject } from "react";

const SEARCH_DEBOUNCE_MS = 300;

export function clampCommentPage(page: number, totalPages: number) {
  return Math.min(Math.max(1, page), Math.max(1, totalPages));
}

export function useCommentPagination(sectionRef: RefObject<HTMLElement | null>) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  const changePage = useCallback((next: number, totalPages: number) => {
    setPage(clampCommentPage(next, totalPages));
    window.requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [sectionRef]);

  const updateSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const revealPosted = useCallback((replyToId: string | null | undefined, totalPages: number) => {
    if (replyToId) return;
    setSearch("");
    setDebouncedSearch("");
    setPage(Math.max(1, totalPages));
  }, []);

  return { search, debouncedSearch, page, changePage, updateSearch, revealPosted };
}
