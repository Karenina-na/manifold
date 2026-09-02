import type { Content, SiteComposition } from "@manifold/contracts";
import { ManifoldClient } from "@manifold/sdk";

const coreUrl = process.env.NEXT_PUBLIC_CORE_URL ?? "http://localhost:8080";
const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: "no-store" });
const MAX_CONTENT_HISTORY = 1000;

export const fallbackSiteTitle = "Manifold";
export const fallbackSiteDescription = "Profile, technical writings, short thoughts, and personal projects.";
export const fallbackSiteFooter = "Built for notes that stay in motion.";

export function createServerClient() {
  return new ManifoldClient({ baseUrl: coreUrl, fetch: noStoreFetch });
}

export function createBrowserClient() {
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

async function fetchPublicContent(client: ManifoldClient, kind: Content["kind"], includeHistory: boolean) {
  const items: Content[] = [];
  let pageNumber = 1;
  do {
    try {
      const page = await client.content({ kind, page: pageNumber, pageSize: includeHistory ? 50 : 10 });
      items.push(...page.data);
      if (!includeHistory || items.length >= MAX_CONTENT_HISTORY) break;
      if (pageNumber >= page.pagination.totalPages) break;
      pageNumber += 1;
    } catch (error) {
      if (!items.length) throw error;
      break;
    }
  } while (items.length < MAX_CONTENT_HISTORY);
  return items.slice(0, MAX_CONTENT_HISTORY);
}

export async function loadHomeData({ includeHistory = true }: { includeHistory?: boolean } = {}) {
  const client = createServerClient();
  try {
    const fetchContent = (kind: Content["kind"]) => fetchPublicContent(client, kind, includeHistory);
    const [profile, site, writings, thoughts, stats] = await Promise.all([
      client.profile(), client.site(), fetchContent("ARTICLE"), fetchContent("THOUGHT"), client.stats(),
    ]);
    const contentHistory = [...writings, ...thoughts].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const feed = [...contentHistory].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    return { profile, site, feed, contentHistory, stats, error: null };
  } catch {
    return { profile: null, site: null, feed: null, contentHistory: [], stats: null, error: "Core is unavailable right now. Please try again in a moment." };
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
