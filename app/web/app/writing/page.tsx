import type { ContentSort } from "@manifold/contracts";
import { createServerClient } from "../../lib/api";
import { readSearchPage, readSearchParam, readSearchTags, readSearchText } from "../../features/archive/search-params";
import WritingArchive from "../../features/archive/writing-archive-view";

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
  const [archive, tagPage, site] = await Promise.all([
    client.content({
      kind: "ARTICLE",
      q: query || undefined,
      tag: tags.length ? tags : undefined,
      sort,
      aiAssisted: noAi ? false : undefined,
      page,
      pageSize: PAGE_SIZE,
    }).catch(() => null),
    client.tags({ kind: "ARTICLE" }).catch(() => null),
    client.site().catch(() => null),
  ]);
  return <WritingArchive
    key={`${query}|${tags.join(",")}|${sort}|${noAi ? 1 : 0}|${page}`}
    initialList={archive ? {
      items: archive.data.filter((item): item is Extract<(typeof archive.data)[number], { kind: "ARTICLE" }> => item.kind === "ARTICLE"),
      totalItems: archive.pagination.totalItems,
      totalPages: archive.pagination.totalPages,
      page: archive.pagination.page,
    } : null}
    pinned={filtersActive || sort !== "newest" ? [] : (site?.pinnedWritings ?? [])}
    tags={tagPage?.data ?? null}
    query={query}
    activeTags={tags}
    sort={sort}
    noAi={noAi}
  />;
}
