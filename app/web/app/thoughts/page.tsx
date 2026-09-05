import { createServerClient } from "../../lib/api";
import type { Content } from "@manifold/contracts";
import { readSearchPage, readSearchTags, readSearchText } from "../../lib/search-params";
import ThoughtArchive from "./thought-archive";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 8;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ThoughtsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const query = readSearchText(params, "q", 200);
  const tags = readSearchTags(params);
  const page = readSearchPage(params);
  const client = createServerClient();
  const [archive, tagsPage, site] = await Promise.all([
    client.content({ kind: "THOUGHT", page, pageSize: PAGE_SIZE, q: query || undefined, tag: tags.length ? tags : undefined }).then((result) => ({ ...result, data: result.data.filter((item): item is Extract<Content, { kind: "THOUGHT" }> => item.kind === "THOUGHT") })).catch(() => null),
    client.tags({ kind: "THOUGHT" }).catch(() => null),
    client.site().catch(() => null),
  ]);
  const pinned = site?.pinnedThoughts ?? [];
  return <ThoughtArchive key={`${query}|${tags.join(",")}|${page}`} initialArchive={archive} pinned={pinned} tags={tagsPage?.data ?? null} initialQuery={query} initialTags={tags} />;
}
