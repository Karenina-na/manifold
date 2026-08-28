"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { archiveHref, type ArchiveExtraParams, type ArchiveFilterState } from "./archive-url";

const SEARCH_DEBOUNCE_MS = 300;

type UseArchiveFiltersOptions<T> = {
  basePath: string;
  initialData: T | null;
  initialQuery?: string;
  initialTags?: string[];
  initialPage?: number;
  initialExtra?: ArchiveExtraParams;
  fetchPage: (state: ArchiveFilterState, extra: ArchiveExtraParams) => Promise<T>;
  onPageSettled?: () => void;
};

export function useArchiveFilters<T>(options: UseArchiveFiltersOptions<T>) {
  const { basePath, initialData, initialQuery = "", initialTags = [], initialPage = 1, initialExtra } = options;

  const [input, setInput] = useState(initialQuery);
  const [state, setState] = useState<ArchiveFilterState>(() => ({ query: initialQuery, tags: initialTags, page: initialPage }));
  const [extra, setExtra] = useState<ArchiveExtraParams>(() => ({ ...initialExtra }));
  const [data, setData] = useState<T | null>(initialData);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState(false);

  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchPageRef = useRef(options.fetchPage);
  const onPageSettledRef = useRef(options.onPageSettled);

  useEffect(() => {
    fetchPageRef.current = options.fetchPage;
    onPageSettledRef.current = options.onPageSettled;
  });

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const request = useCallback(async (nextState: ArchiveFilterState, nextExtra: ArchiveExtraParams, trigger: "filter" | "page") => {
    const seq = ++seqRef.current;
    setIsPending(true);
    setError(false);
    try {
      const result = await fetchPageRef.current(nextState, nextExtra);
      if (seq !== seqRef.current) return;
      setData(result);
      if (trigger === "page") onPageSettledRef.current?.();
    } catch {
      if (seq !== seqRef.current) return;
      setError(true);
    } finally {
      if (seq === seqRef.current) setIsPending(false);
    }
  }, []);

  const clearDebounce = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const apply = useCallback((nextState: ArchiveFilterState, nextExtra: ArchiveExtraParams, trigger: "filter" | "page") => {
    setState(nextState);
    setExtra(nextExtra);
    window.history.replaceState(null, "", archiveHref(basePath, nextState, nextExtra));
    void request(nextState, nextExtra, trigger);
  }, [basePath, request]);

  const onSearchInput = useCallback((value: string) => {
    setInput(value);
    clearDebounce();
    timerRef.current = setTimeout(() => {
      apply({ query: value.trim(), tags: state.tags, page: 1 }, extra, "filter");
    }, SEARCH_DEBOUNCE_MS);
  }, [apply, clearDebounce, extra, state]);

  const toggleTag = useCallback((name: string) => {
    clearDebounce();
    const tags = state.tags.includes(name) ? state.tags.filter((tag) => tag !== name) : [...state.tags, name];
    apply({ query: input.trim(), tags, page: 1 }, extra, "filter");
  }, [apply, clearDebounce, extra, input, state]);

  const goToPage = useCallback((next: number) => {
    clearDebounce();
    apply({ ...state, page: Math.max(1, next) }, extra, "page");
  }, [apply, clearDebounce, extra, state]);

  const setExtraParam = useCallback((key: string, value: string | undefined) => {
    clearDebounce();
    apply({ ...state, query: input.trim(), page: 1 }, { ...extra, [key]: value }, "filter");
  }, [apply, clearDebounce, extra, input, state]);

  return { input, query: state.query, tags: state.tags, page: state.page, extra, data, isPending, error, onSearchInput, toggleTag, goToPage, setExtraParam };
}
