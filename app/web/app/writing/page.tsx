import type { ContentSort } from "@manifold/contracts";
import { createServerClient } from "../../lib/api";
import { readSearchPage, readSearchParam, readSearchTags, readSearchText } from "../../lib/search-params";
import WritingArchive from "./writing-archive";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;
const SORTS: ContentSort[] = ["newest", "oldest", "updated"];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function WritingPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const query = readSearchText(params, "q", 200);
  const tags = readSearchTags(params);
  const rawSort = readSearchParam(params, "sort") as ContentSort;
  const sort: ContentSort = SORTS.includes(rawSort) ? rawSort : "newest";
  const noAi = readSearchParam(params, "noAi") === "1";
  const page = readSearchPage(params);

  const filtersActive = Boolean(query || tags.length || noAi);
  const client = createServerClient();
  const [archive, tagPage] = await Promise.all([
    client.writings({
      q: query || undefined,
      tag: tags.length ? tags : undefined,
      sort,
      aiAssisted: noAi ? false : undefined,
      page,
      limit: PAGE_SIZE,
    }).catch(() => null),
    client.tags({ kind: "ARTICLE" }).catch(() => null),
  ]);
  return <WritingArchive
    key={`${query}|${tags.join(",")}|${sort}|${noAi ? 1 : 0}|${page}`}
    initialList={archive ? {
      items: archive.data,
      totalItems: archive.pagination.totalItems ?? 0,
      totalPages: archive.pagination.totalPages ?? 1,
      page: archive.pagination.page ?? page,
    } : null}
    featured={filtersActive || sort !== "newest" ? null : archive?.featured ?? null}
    tags={tagPage?.data ?? null}
    query={query}
    activeTags={tags}
    sort={sort}
    noAi={noAi}
  />;
}
