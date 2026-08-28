import { createServerClient } from "../../lib/api";
import { readSearchPage, readSearchText } from "../../lib/search-params";
import ThoughtArchive from "./thought-archive";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 8;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ThoughtsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const query = readSearchText(params, "q", 200);
  const tag = readSearchText(params, "tag", 80);
  const page = readSearchPage(params);
  const client = createServerClient();
  const [archive, tags] = await Promise.all([
    client.thoughts({ page, limit: PAGE_SIZE, q: query || undefined, tag: tag || undefined }).catch(() => null),
    client.tags({ kind: "THOUGHT" }).catch(() => null),
  ]);
  return <ThoughtArchive key={`${query}|${tag}|${page}`} initialArchive={archive} tags={tags?.data ?? null} initialQuery={query} initialTag={tag} />;
}
