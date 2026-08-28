import { createServerClient } from "../../lib/api";
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
  const [archive, tagsPage] = await Promise.all([
    client.thoughts({ page, limit: PAGE_SIZE, q: query || undefined, tag: tags.length ? tags : undefined }).catch(() => null),
    client.tags({ kind: "THOUGHT" }).catch(() => null),
  ]);
  return <ThoughtArchive key={`${query}|${tags.join(",")}|${page}`} initialArchive={archive} tags={tagsPage?.data ?? null} initialQuery={query} initialTags={tags} />;
}
