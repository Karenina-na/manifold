import { cache } from "react";
import type { Content, ContentDetail, SiteComposition } from "@manifold/contracts";
import type { Locale } from "../i18n/locale";
import { ManifoldClient } from "@manifold/sdk";

const coreUrl = process.env.NEXT_PUBLIC_CORE_URL ?? "http://localhost:8080";
const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: "no-store" });

export const fallbackSiteTitle = "Manifold";
export const fallbackSiteDescription = "Profile, technical writings, short thoughts, and personal projects.";
export const fallbackSiteFooter = "Built for notes that stay in motion.";

export function createServerClient() {
  return new ManifoldClient({ baseUrl: coreUrl, fetch: noStoreFetch });
}

export function createBrowserClient() {
  return new ManifoldClient({ baseUrl: coreUrl, fetch: noStoreFetch, browserVisitorCookie: true });
}

// Guest-mode comments must not carry the visitor JWT: without browserVisitorCookie
// the SDK never reads the manifold-visitor cookie into an Authorization header.
export function createAnonymousBrowserClient() {
  return new ManifoldClient({ baseUrl: coreUrl, fetch: noStoreFetch });
}

export function buildHref(content: Pick<Content, "kind" | "slug">) {
  return content.kind === "ARTICLE" ? `/writing/${encodeURIComponent(content.slug)}` : `/thoughts/${encodeURIComponent(content.slug)}`;
}

// Wrapped in React's per-request `cache()`: the root layout's generateMetadata
// and its render body both need the site composition, and the detail pages need
// it a third time. Without the memo the same request hits Core repeatedly.
export const loadSiteData = cache(async (): Promise<SiteComposition | null> => {
  try {
    return await createServerClient().site();
  } catch {
    return null;
  }
});

// One loader for a detail page's content. `generateMetadata` and the page body
// must call it with identical arguments — same referrer, same visitor id — or
// `cache()` sees two keys and Core is fetched twice, once per render pass.
export const loadContentDetail = cache(async (slug: string, referrer: string | undefined, visitorId: string | undefined): Promise<ContentDetail | null> => {
  try {
    return await createServerClient().contentBySlug(slug, referrer ? { referrer } : undefined, visitorId);
  } catch {
    return null;
  }
});

export function getVisitorId() {
  const storageKey = "manifold.visitorId";
  const stored = window.localStorage.getItem(storageKey);
  const value = stored ?? (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `visitor-${Math.random().toString(36).slice(2)}-${Date.now()}`);
  if (!stored) window.localStorage.setItem(storageKey, value);
  // Server Components cannot read localStorage; mirroring the id into a cookie
  // lets detail pages attribute view events for per-visitor dedup analytics.
  // Secure is added only over TLS: browsers drop Secure cookies on plain http,
  // and this mirror is an analytics convenience, not a credential.
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `manifold-vid=${value}; path=/; max-age=31536000; samesite=lax${secure}`;
  return value;
}

async function fetchRecentPublicContent(client: ManifoldClient, kind: Content["kind"]) {
  const page = await client.content({ kind, page: 1, pageSize: 10 });
  return page.data;
}

export async function loadHomeData() {
  const client = createServerClient();
  try {
    // tags feeds the home topic rail; a tags failure must never take the
    // whole homepage down, so it degrades to an empty list on its own.
    const [profile, site, writings, thoughts, timeline, stats, tagsResult] = await Promise.all([
      client.profile(), client.site(), fetchRecentPublicContent(client, "ARTICLE"), fetchRecentPublicContent(client, "THOUGHT"), client.homeTimeline(), client.stats(),
      client.tags().catch(() => null),
    ]);
    const tags = tagsResult?.data ?? [];
    const feed = [...writings, ...thoughts].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    return { profile, site, feed, timeline, stats, tags, error: null };
  } catch {
    return { profile: null, site: null, feed: null, timeline: { data: [], totalItems: 0, truncated: false }, stats: null, tags: [], error: "Core is unavailable right now. Please try again in a moment." };
  }
}

export async function loadFeedData() {
  const client = createServerClient();
  try {
    const [writings, thoughts] = await Promise.all([
      fetchRecentPublicContent(client, "ARTICLE"),
      fetchRecentPublicContent(client, "THOUGHT"),
    ]);
    return [...writings, ...thoughts].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  } catch {
    return [];
  }
}

export function formatDate(value: string | null, locale: Locale = "en", unpublished = "Unpublished") {
  if (!value) return unpublished;
  return new Intl.DateTimeFormat(locale, { month: "short", day: "2-digit", year: "numeric" }).format(new Date(value));
}
