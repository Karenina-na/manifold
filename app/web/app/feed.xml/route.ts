import { loadHomeData } from "../../lib/api";

export const dynamic = "force-dynamic";

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export async function GET() {
  const data = await loadHomeData({ includeHistory: false });
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const feedItems = data.feed ? [
    ...data.feed.filter((item) => item.kind === "ARTICLE").slice(0, 2),
    ...data.feed.filter((item) => item.kind === "THOUGHT").slice(0, 3),
  ].sort((a, b) => Date.parse(b.publishedAt ?? b.createdAt) - Date.parse(a.publishedAt ?? a.createdAt)) : [];
  const items = feedItems.map((item) => {
    const title = item.title || "Untitled thought";
    const description = item.summary || "A published note from Manifold.";
    const date = item.publishedAt ?? item.createdAt;
    return `<item><title>${escapeXml(title)}</title><description>${escapeXml(description)}</description><link>${siteUrl}${item.href}</link><guid>${siteUrl}${item.href}</guid><pubDate>${new Date(date).toUTCString()}</pubDate></item>`;
  }).join("") ?? "";
  const body = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Manifold</title><description>Published writings and thoughts from Manifold.</description><link>${siteUrl}</link><atom:link href="${siteUrl}/feed.xml" rel="self" type="application/rss+xml" xmlns:atom="http://www.w3.org/2005/Atom"/>${items}</channel></rss>`;
  return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
