"use client";

import Link from "next/link";
import { Eye, Heart, Search, SlidersHorizontal } from "lucide-react";
import { formatDate } from "../../lib/api";
import { useRef } from "react";
import type { Content, ContentSort, TagSummary } from "@manifold/contracts";
import styles from "../site.module.css";
import { Reveal } from "../../components/reveal";
import { ScrollHint } from "../../components/scroll-hint";
import { TagCloud } from "../../components/tag-cloud";
import { TagPicker } from "../../components/tag-picker";
import { createBrowserClient } from "../../lib/api";
import { clampPage } from "../../lib/archive-url";
import { useArchiveFilters } from "../../lib/use-archive-filters";
import { useCenteredAside } from "../../lib/use-centered-aside";
import { previewForContent } from "../../lib/content-preview";
import { Pagination } from "../../components/pagination";

const PAGE_SIZE = 10;

type WritingListData = { items: Content[]; totalItems: number; totalPages: number; page: number };

type WritingArchiveProps = {
  initialList: WritingListData | null;
  featured: Content | null;
  tags: TagSummary[] | null;
  query: string;
  activeTags: string[];
  sort: ContentSort;
  noAi: boolean;
};

async function fetchWritingPage(state: { query: string; tags: string[]; page: number }, extra: Record<string, string | undefined>): Promise<WritingListData> {
  const sort = extra.sort as ContentSort | undefined;
  const unfiltered = !state.query && state.tags.length === 0 && extra.noAi !== "1" && (!sort || sort === "newest");
  const page = await createBrowserClient().content({
    kind: "ARTICLE",
    q: state.query || undefined,
    tag: state.tags.length ? state.tags : undefined,
    sort,
    aiAssisted: extra.noAi === "1" ? false : undefined,
    page: state.page,
    limit: PAGE_SIZE,
    skipFirst: unfiltered || undefined,
  });
  return { items: page.data, totalItems: page.pagination.totalItems ?? 0, totalPages: page.pagination.totalPages ?? 1, page: page.pagination.page ?? state.page };
}

export default function WritingArchive({ initialList, featured, tags, query, activeTags, sort, noAi }: WritingArchiveProps) {
  const asideSlotRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLElement>(null);
  useCenteredAside(asideSlotRef, asideRef);
  const { input, query: activeQuery, tags: selectedTags, extra, data, isPending, error, onSearchInput, toggleTag, goToPage, setExtraParam } = useArchiveFilters<WritingListData>({
    basePath: "/writing",
    initialData: initialList,
    initialQuery: query,
    initialTags: activeTags,
    initialExtra: { sort: sort === "newest" ? undefined : sort, noAi: noAi ? "1" : undefined },
    fetchPage: fetchWritingPage,
  });
  const activeSort = (extra.sort as ContentSort) ?? "newest";
  const noAiActive = extra.noAi === "1";
  const showFeatured = !activeQuery && selectedTags.length === 0 && !noAiActive && activeSort === "newest";
  const articles = data?.items ?? [];

  const changePage = (next: number) => {
    if (!data || isPending) return;
    goToPage(clampPage(next, data.totalPages));
  };

  return <main className={styles.page}><div className={styles.writingShell}><div className={styles.writingMain}>
    <Reveal className={styles.writingReveal}>
      <header className={styles.writingHero}><span className={styles.eyebrow}>Writings</span><h1>Writing</h1></header>
    </Reveal>
    {showFeatured && featured && <Reveal className={styles.writingReveal}>
      <Link href={featured.href} className={styles.featuredCard}>
        <div className={styles.featuredTop}><span className={styles.featuredBadge}>Featured</span><span>{formatDate(featured.publishedAt ?? featured.createdAt)}</span></div>
        <h2>{featured.title}</h2>
        <WritingPreview item={featured} featured />
        <div className={styles.featuredFooter}><span>{formatDate(featured.publishedAt ?? featured.createdAt)} · {featured.tags.map((value) => `#${value}`).join(" ")} · {featured.kind === "ARTICLE" && featured.metadata.readingMinutes ? `${featured.metadata.readingMinutes} min read` : "Article"}</span><span><Eye size={14} /> Views {featured.viewCount ?? 0} · <Heart size={14} /> Likes {featured.likeCount ?? 0}</span></div>
        <span className={styles.featuredArrow} aria-hidden="true">→</span>
      </Link>
    </Reveal>}
    {data === null ? <p className={styles.errorBanner}>The writings could not be loaded.</p> : <Reveal className={styles.writingReveal} manual={showFeatured}>
      <section className={styles.writingCollection} ref={listRef}>
        <div className={styles.writingToolbarSurface}>
          <div className={styles.writingToolbar}>
            <span>{data.totalItems} articles</span>
            <div className={styles.toolbarControls}>
              <button className={noAiActive ? styles.controlActive : styles.control} onClick={() => setExtraParam("noAi", noAiActive ? undefined : "1")}><SlidersHorizontal size={14} /> No AI writing</button>
              <select value={activeSort} onChange={(event) => setExtraParam("sort", event.target.value === "newest" ? undefined : event.target.value)} aria-label="Sort writings">
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="updated">Recently updated</option>
              </select>
            </div>
          </div>
        </div>
        <div className={styles.writingListSurface} data-pending={isPending}>
          <div className={styles.writingList}>
            {articles.map((item) => <Link className={styles.writingItem} key={item.id} href={item.href}>
              <h3>{item.title}</h3>
              <WritingPreview item={item} />
              <div>
                <span>{formatDate(item.publishedAt ?? item.createdAt)}</span>
                <span>{item.tags.map((value) => `#${value}`).join(" ")}</span>
                <span>{item.kind === "ARTICLE" && item.metadata.readingMinutes ? `${item.metadata.readingMinutes} min read` : "Article"}</span>
                <span><Eye size={12} /> {item.viewCount ?? 0} · <Heart size={12} /> {item.likeCount ?? 0}</span>
              </div>
            </Link>)}
          </div>
          {!articles.length && <p className={styles.thoughtEmpty}>No writings match the current filters.</p>}
        </div>
        {data.totalPages > 1 && <Pagination page={data.page} totalPages={data.totalPages} onChange={changePage} disabled={isPending} label="Writing pages" />}
        {error && <p className={styles.errorBanner}>The latest writing page could not be loaded. Please try again.</p>}
      </section>
    </Reveal>}
  </div>
    <div className={styles.writingAsideSlot} ref={asideSlotRef}>
    <aside className={styles.writingAside} ref={asideRef}>
      <label className={styles.writingSearch}>
        <Search size={16} />
        <input value={input} onChange={(event) => onSearchInput(event.target.value)} placeholder="Search writings" aria-label="Search writings" />
      </label>
      {tags?.length ? <TagCloud tags={tags} activeTags={selectedTags} onToggle={toggleTag} /> : null}
      <div className={styles.archiveBlock}>
        <div className={styles.asideLabel}>Archive</div>
        <p>{data?.totalItems ?? 0} writings</p>
        {tags?.length ? <TagPicker tags={tags} activeTags={selectedTags} onToggle={toggleTag} label="View all tags →" /> : null}
      </div>
    </aside>
  </div>
</div>
<ScrollHint manual={showFeatured} targetRef={listRef} />
</main>;
}

function WritingPreview({ item, featured = false }: { item: Content; featured?: boolean }) {
  const preview = previewForContent(item);
  return <>
    {preview.summary && <p className={styles.writingSummary}><span aria-hidden="true">✦</span>{preview.summary}</p>}
    {preview.excerpt && <p className={featured ? styles.writingExcerptFeatured : styles.writingExcerpt}>{preview.excerpt}</p>}
  </>;
}
