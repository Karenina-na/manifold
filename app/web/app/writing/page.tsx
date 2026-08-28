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
  const skipFirst = !filtersActive && sort === "newest";
  const client = createServerClient();
  const [featuredPage, listPage, tagPage] = await Promise.all([
    client.content({ kind: "ARTICLE", sort: "newest", limit: 1 }).catch(() => null),
    client.content({
      kind: "ARTICLE",
      q: query || undefined,
      tag: tags.length ? tags : undefined,
      sort,
      aiAssisted: noAi ? false : undefined,
      page,
      limit: PAGE_SIZE,
      skipFirst,
    }).catch(() => null),
    client.tags({ kind: "ARTICLE" }).catch(() => null),
  ]);
  return <WritingArchive
    key={`${query}|${tags.join(",")}|${sort}|${noAi ? 1 : 0}|${page}`}
    initialList={listPage ? {
      items: listPage.data,
      totalItems: listPage.pagination.totalItems ?? 0,
      totalPages: listPage.pagination.totalPages ?? 1,
      page: listPage.pagination.page ?? page,
    } : null}
    featured={featuredPage?.data[0] ?? null}
    tags={tagPage?.data ?? null}
    query={query}
    activeTags={tags}
    sort={sort}
    noAi={noAi}
  />;
}
