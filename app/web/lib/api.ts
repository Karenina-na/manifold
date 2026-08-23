import { ManifoldClient } from "@manifold/sdk";

const coreUrl = process.env.NEXT_PUBLIC_CORE_URL ?? "http://localhost:8080";
const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: "no-store" });

export function createServerClient() {
  return new ManifoldClient({ baseUrl: coreUrl, fetch: noStoreFetch });
}

export function createBrowserClient() {
  return new ManifoldClient({ baseUrl: coreUrl });
}

export async function loadHomeData() {
  const client = createServerClient();
  try {
    const [profile, site, feed, projects, now, stats] = await Promise.all([
      client.profile(), client.site(), client.feed({ limit: 6 }), client.projects(), client.now(), client.stats(),
    ]);
    return { profile, site, feed, projects, now, stats, error: null };
  } catch {
    return { profile: null, site: null, feed: null, projects: null, now: null, stats: null, error: "Core is unavailable right now. Please try again in a moment." };
  }
}

export function formatDate(value: string | null) {
  if (!value) return "Unpublished";
  return new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", year: "numeric" }).format(new Date(value));
}
