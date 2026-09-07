"use client";

import Link from "next/link";
import { ArrowRight, Eye, Heart, Search, SlidersHorizontal } from "lucide-react";
import { buildHref, formatDate } from "../../lib/api";
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

type Article = Extract<Content, { kind: "ARTICLE" }>;
type WritingListData = { items: Article[]; totalItems: number; totalPages: number; page: number };

type WritingArchiveProps = {
  initialList: WritingListData | null;
  pinned: Article[];
  tags: TagSummary[] | null;
  query: string;
  activeTags: string[];
  sort: ContentSort;
  noAi: boolean;
};

async function fetchWritingPage(state: { query: string; tags: string[]; page: number }, extra: Record<string, string | undefined>): Promise<WritingListData> {
  const sort = extra.sort as ContentSort | undefined;
  const page = await createBrowserClient().content({ kind: "ARTICLE",
    q: state.query || undefined,
    tag: state.tags.length ? state.tags : undefined,
    sort,
    aiAssisted: extra.noAi === "1" ? false : undefined,
    page: state.page,
    pageSize: PAGE_SIZE,
  });
  return { items: page.data.filter((item): item is Article => item.kind === "ARTICLE"), totalItems: page.pagination.totalItems, totalPages: page.pagination.totalPages, page: page.pagination.page };
}

export default function WritingArchive({ initialList, pinned, tags, query, activeTags, sort, noAi }: WritingArchiveProps) {
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
  const showPinned = !activeQuery && selectedTags.length === 0 && !noAiActive && activeSort === "newest";
  const articles = data?.items ?? [];
  const heroTotal = initialList?.totalItems ?? 0;
  const latestAt = initialList?.items[0]?.publishedAt ?? null;

  const changePage = (next: number) => {
    if (!data || isPending) return;
    goToPage(clampPage(next, data.totalPages));
  };

  return <main className={styles.page} data-route="writing"><div className={styles.writingShell}><div className={styles.writingMain}>
    <Reveal className={styles.writingReveal}>
      <header className={styles.writingHero}>
        <div>
          <span className={styles.eyebrow}>✦ Writings</span>
          <h1>Writing</h1>
        </div>
        <div className={styles.writingHeroStatus}>
          <span className={styles.chainPulse}><span className={styles.chainPulseDot} aria-hidden="true" /> In motion</span>
          <span className={styles.writingHeroStat}>{heroTotal} articles · last {latestAt ? formatDate(latestAt) : "—"}</span>
        </div>
      </header>
    </Reveal>
    {showPinned && pinned.length > 0 && <Reveal className={styles.writingReveal}>
      <div className={styles.pinnedRow}>
        {pinned.map((item) => <Link key={item.id} href={buildHref(item)} className={styles.featuredCard}>
          <div className={styles.featuredTop}><span className={styles.featuredBadge}>Pinned</span><span>{formatDate(item.publishedAt ?? item.createdAt)}</span></div>
          <h2>{item.title}</h2>
          <WritingPreview item={item} featured />
          <div className={styles.featuredFooter}><span>{formatDate(item.publishedAt)} · {item.tags.map((value) => `#${value}`).join(" ")} · {item.metadata.readingMinutes ? `${item.metadata.readingMinutes} min read` : "Article"}</span><span><Eye size={14} /> Views {item.viewCount} · <Heart size={14} /> Likes {item.likeCount}</span></div>
          <span className={styles.featuredArrow} aria-hidden="true">→</span>
        </Link>)}
      </div>
    </Reveal>}
    {data === null ? <p className={styles.errorBanner}>The writings could not be loaded.</p> : <Reveal className={styles.writingReveal} manual={showPinned}>
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
            {articles.map((item, index) => <Link className={styles.writingItem} key={item.id} href={buildHref(item)}>
              <span className={styles.writingItemIndex} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <span className={styles.writingItemBody}>
                <h3>{item.title}</h3>
                <WritingPreview item={item} />
                <div>
                  <span>{formatDate(item.publishedAt)}</span>
                  <span>{item.tags.map((value) => `#${value}`).join(" ")}</span>
                  <span>{item.metadata.readingMinutes ? `${item.metadata.readingMinutes} min read` : "Article"}</span>
                  <span><Eye size={12} /> {item.viewCount} · <Heart size={12} /> {item.likeCount}</span>
                </div>
              </span>
              <ArrowRight size={14} className={styles.writingItemArrow} aria-hidden="true" />
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
<ScrollHint manual={showPinned} targetRef={listRef} />
</main>;
}

function WritingPreview({ item, featured = false }: { item: Content; featured?: boolean }) {
  const preview = previewForContent(item);
  return <>
    {preview.summary && <p className={styles.writingSummary}><span aria-hidden="true">✦</span>{preview.summary}</p>}
    {preview.excerpt && <p className={featured ? styles.writingExcerptFeatured : styles.writingExcerpt}>{preview.excerpt}</p>}
  </>;
}
