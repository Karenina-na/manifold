import type { Content, SiteComposition } from "@manifold/contracts";
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

export async function loadSiteData(): Promise<SiteComposition | null> {
  try {
    return await createServerClient().site();
  } catch {
    return null;
  }
}

export function getVisitorId() {
  const storageKey = "manifold.visitorId";
  const stored = window.localStorage.getItem(storageKey);
  const value = stored ?? (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `visitor-${Math.random().toString(36).slice(2)}-${Date.now()}`);
  if (!stored) window.localStorage.setItem(storageKey, value);
  // Server Components cannot read localStorage; mirroring the id into a cookie
  // lets detail pages attribute view events for per-visitor dedup analytics.
  document.cookie = `manifold-vid=${value}; path=/; max-age=31536000; samesite=lax`;
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

export async function loadPapers() {
  try {
    const page = await createServerClient().content({ kind: "ARTICLE", pageSize: 50 });
    return page.data.map((item) => ({ title: item.title ?? "Untitled writing", href: buildHref(item) }));
  } catch {
    return [];
  }
}

export function formatDate(value: string | null) {
  if (!value) return "Unpublished";
  return new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", year: "numeric" }).format(new Date(value));
}
