"use client";

import type { Collection, Content, TagSummary } from "@manifold/contracts";
import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef } from "react";
import { Reveal } from "../../components/reveal";
import { ScrollHint } from "../../components/scroll-hint";
import { TagCloud } from "../../components/tag-cloud";
import { TagPicker } from "../../components/tag-picker";
import { ThoughtActions } from "../../components/thought-actions";
import { buildHref, createBrowserClient } from "../../lib/api";
import { clampPage } from "../../lib/archive-url";
import { useArchiveFilters } from "../../lib/use-archive-filters";
import { groupThoughtsByYear, formatThoughtDate } from "../../lib/thought-archive";
import { previewForContent } from "../../lib/content-preview";
import { Pagination } from "../../components/pagination";
import styles from "../site.module.css";

type Thought = Extract<Content, { kind: "THOUGHT" }>;

const PAGE_SIZE = 8;

function tagLabel(tags: string[]) {
  return tags.length ? tags.map((tag) => `#${tag}`).join(" · ") : "#thought";
}

function ThoughtPreview({ item, featured = false }: { item: Thought; featured?: boolean }) {
  const preview = previewForContent(item);
  return <>
    {preview.summary && <p className="thoughtSummary"><span aria-hidden="true">✦</span>{preview.summary}</p>}
    {preview.excerpt && <p className={featured ? styles.thoughtExcerptFeatured : styles.thoughtExcerpt}>{preview.excerpt}</p>}
  </>;
}

type ThoughtArchiveProps = {
  initialArchive: Collection<Thought> | null;
  pinned: Thought[];
  tags: TagSummary[] | null;
  initialQuery?: string;
  initialTags?: string[];
};

export default function ThoughtArchive({ initialArchive, pinned, tags, initialQuery = "", initialTags = [] }: ThoughtArchiveProps) {
  const timelineRef = useRef<HTMLElement>(null);
  const { input, query, tags: selectedTags, data, isPending, error, onSearchInput, toggleTag, goToPage } = useArchiveFilters({
    basePath: "/thoughts",
    initialData: initialArchive,
    initialQuery,
    initialTags,
    fetchPage: (state) => createBrowserClient().content({ kind: "THOUGHT", page: state.page, pageSize: PAGE_SIZE, q: state.query || undefined, tag: state.tags.length ? state.tags : undefined }) as Promise<Collection<Thought>>,
    onPageSettled: () => window.requestAnimationFrame(() => timelineRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })),
  });
  const filtersActive = Boolean(query || selectedTags.length);
  const totalPages = data?.pagination.totalPages ?? 1;
  const yearGroups = useMemo(() => groupThoughtsByYear(data?.data ?? []), [data]);

  const changePage = (next: number) => {
    if (!data || isPending) return;
    goToPage(clampPage(next, data.pagination.totalPages));
  };

  return <main className={styles.page}>
    <div className={styles.thoughtShell}>
      <Reveal className={styles.writingReveal}>
        <header className={styles.thoughtHero}>
          <span className={styles.eyebrow}>Thoughts</span>
          <h1>Thoughts</h1>
        </header>
      </Reveal>

      {!filtersActive && pinned.length > 0 && <Reveal className={styles.writingReveal}>
        <div className={styles.pinnedRow}>
          {pinned.map((item) => <article className={styles.featuredThought} key={item.id}>
            <div className={styles.featuredThoughtTop}>
              <span className={styles.featuredBadge}>Pinned</span>
              <div className={styles.featuredThoughtMeta}><span>{tagLabel(item.tags)}</span><time dateTime={item.publishedAt}>{formatThoughtDate(item.publishedAt)}</time></div>
            </div>
            <h2><Link href={buildHref(item)}>{item.title || "A thought"}</Link></h2>
            <ThoughtPreview item={item} featured />
            <footer className={styles.featuredThoughtFooter}>
              <ThoughtActions item={item} />
              <Link className={styles.thoughtReadLink} href={buildHref(item)}>Full thought <ArrowRight size={15} aria-hidden="true" /></Link>
            </footer>
          </article>)}
        </div>
      </Reveal>}

      {data === null ? <p className={styles.errorBanner}>The thoughts could not be loaded.</p> : <Reveal className={styles.writingReveal} manual={!filtersActive}>
        <section className={styles.thoughtCollection} ref={timelineRef} aria-labelledby="thought-timeline-heading">
          <div className={styles.thoughtSectionHeading}>
            <div>
              <span className={styles.eyebrow}>Archive</span>
              <h2 id="thought-timeline-heading">Thought timeline</h2>
            </div>
            <span>{data.pagination.totalItems} notes</span>
          </div>

          <div className={`${styles.writingToolbarSurface} ${styles.thoughtFilterSurface}`}>
            <div className={styles.thoughtFilterSearch}>
              <label className={styles.writingSearch}>
                <Search size={16} aria-hidden="true" />
                <input value={input} onChange={(event) => onSearchInput(event.target.value)} placeholder="Search thoughts" aria-label="Search thoughts" />
              </label>
            </div>
            {tags?.length ? <TagCloud tags={tags} activeTags={selectedTags} onToggle={toggleTag} action={<TagPicker tags={tags} activeTags={selectedTags} onToggle={toggleTag} label="View all tags" />} /> : null}
          </div>

          {yearGroups.length ? <div className={styles.thoughtTimeline} data-pending={isPending}>
            {yearGroups.map((yearGroup) => <section className={styles.thoughtYear} key={yearGroup.year} aria-labelledby={`year-${yearGroup.year}`}>
              <header className={styles.thoughtYearHeader} id={`year-${yearGroup.year}`}>
                <strong>{yearGroup.year}</strong>
              </header>
              <div className={styles.thoughtYearMonths}>
                {yearGroup.months.map((group) => <div className={styles.thoughtMonth} key={group.key}>
                  <h3 className={styles.thoughtMonthRail} id={`month-${group.key}`}><span className={styles.thoughtMonthLabel}>{group.month}</span></h3>
                  <div className={styles.thoughtMonthItems}>
                    {group.items.map((item) => <div className={styles.thoughtTimelineRow} key={item.id}>
                      <time className={styles.thoughtDateMarker} dateTime={item.publishedAt} aria-label={`${group.label} ${item.day}`}>
                        <span aria-hidden="true" />
                        <strong>{item.day}</strong>
                      </time>
                      <article className={styles.thoughtListCard}>
                        <div className={styles.thoughtListTop}>
                          <h3><Link href={buildHref(item)}>{item.title || "A thought"}</Link></h3>
                          <div><span>{tagLabel(item.tags)}</span><time dateTime={item.publishedAt}>{formatThoughtDate(item.publishedAt)}</time></div>
                        </div>
                        <ThoughtPreview item={item} />
                        <footer>
                          <ThoughtActions item={item} />
                          <Link className={styles.thoughtReadLink} href={buildHref(item)}>Full thought <ArrowRight size={14} aria-hidden="true" /></Link>
                        </footer>
                      </article>
                    </div>)}
                  </div>
                </div>)}
              </div>
            </section>)}
          </div> : <p className={styles.thoughtEmpty}>{filtersActive ? "No thoughts match the current filters." : "No more thoughts have been published yet."}</p>}

          {totalPages > 1 && <Pagination page={data.pagination.page} totalPages={totalPages} onChange={changePage} disabled={isPending} label="Thought pages" />}
          {error && <p className={styles.errorBanner}>The latest thought page could not be loaded. Please try again.</p>}
        </section>
      </Reveal>}
    </div>
    <ScrollHint manual={!filtersActive} targetRef={timelineRef} />
  </main>;
}
