"use client";

import type { Content, ThoughtArchive as ThoughtArchiveResponse } from "@manifold/contracts";
import { ArrowRight, Eye, Heart, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Reveal } from "../../components/reveal";
import { createBrowserClient } from "../../lib/api";
import { groupThoughtsByYear, formatThoughtDate } from "../../lib/thought-archive";
import { previewForContent } from "../../lib/content-preview";
import styles from "../site.module.css";

type Thought = Extract<Content, { kind: "THOUGHT" }>;

const PAGE_SIZE = 8;

function tagLabel(tags: string[]) {
  return tags.length ? tags.map((tag) => `#${tag}`).join(" · ") : "#thought";
}

function ThoughtActions({ item }: { item: Thought }) {
  return <div className={styles.thoughtActions}>
    <span><Heart size={14} aria-hidden="true" /> Likes {item.likeCount ?? 0}</span>
    <span><Eye size={14} aria-hidden="true" /> Views {item.viewCount ?? 0}</span>
    <span><MessageCircle size={14} aria-hidden="true" /> Comments {item.commentCount ?? 0}</span>
  </div>;
}

function ThoughtPreview({ item, featured = false }: { item: Thought; featured?: boolean }) {
  const preview = previewForContent(item);
  return <>
    {preview.summary && <p className={styles.thoughtSummary}><span aria-hidden="true">✦</span>{preview.summary}</p>}
    {preview.excerpt && <p className={featured ? styles.thoughtExcerptFeatured : styles.thoughtExcerpt}>{preview.excerpt}</p>}
  </>;
}

export default function ThoughtArchive({ initialArchive }: { initialArchive: ThoughtArchiveResponse | null }) {
  const [archive, setArchive] = useState(initialArchive);
  const [pageError, setPageError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const timelineRef = useRef<HTMLElement>(null);
  const yearGroups = useMemo(() => groupThoughtsByYear(archive?.data ?? []), [archive]);

  const goToPage = async (nextPage: number) => {
    if (!archive || isLoading) return;
    const page = Math.min(archive.pagination.totalPages, Math.max(1, nextPage));
    setIsLoading(true);
    setPageError(false);
    try {
      setArchive(await createBrowserClient().thoughts({ page, limit: PAGE_SIZE }));
      window.requestAnimationFrame(() => timelineRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch {
      setPageError(true);
    } finally {
      setIsLoading(false);
    }
  };

  return <main className={styles.page}>
    <div className={styles.thoughtShell}>
      <Reveal className={styles.writingReveal}>
        <header className={styles.thoughtHero}>
          <span className={styles.eyebrow}>Thoughts</span>
          <h1>Thoughts</h1>
        </header>
      </Reveal>

      {archive?.featured && <Reveal className={styles.writingReveal}>
        <article className={styles.featuredThought}>
          <div className={styles.featuredThoughtTop}>
            <span className={styles.featuredBadge}>Featured</span>
            <div className={styles.featuredThoughtMeta}><span>{tagLabel(archive.featured.tags)}</span><time dateTime={archive.featured.publishedAt ?? archive.featured.createdAt}>{formatThoughtDate(archive.featured.publishedAt ?? archive.featured.createdAt)}</time></div>
          </div>
          <h2><Link href={archive.featured.href}>{archive.featured.title || "A thought"}</Link></h2>
          <ThoughtPreview item={archive.featured} featured />
          <footer className={styles.featuredThoughtFooter}>
            <ThoughtActions item={archive.featured} />
            <Link className={styles.thoughtReadLink} href={archive.featured.href}>Full thought <ArrowRight size={15} aria-hidden="true" /></Link>
          </footer>
        </article>
      </Reveal>}

      {archive === null ? <p className={styles.errorBanner}>The thoughts could not be loaded.</p> : <Reveal className={styles.writingReveal}>
        <section className={styles.thoughtCollection} ref={timelineRef} aria-labelledby="thought-timeline-heading">
          <div className={styles.thoughtSectionHeading}>
            <div>
              <span className={styles.eyebrow}>Archive</span>
              <h2 id="thought-timeline-heading">Thought timeline</h2>
            </div>
            <span>{archive.pagination.totalItems} notes</span>
          </div>

          {yearGroups.length ? <div className={styles.thoughtTimeline}>
            {yearGroups.map((yearGroup) => <section className={styles.thoughtYear} key={yearGroup.year} aria-labelledby={`year-${yearGroup.year}`}>
              <header className={styles.thoughtYearHeader} id={`year-${yearGroup.year}`}>
                <strong>{yearGroup.year}</strong>
              </header>
              <div className={styles.thoughtYearMonths}>
                {yearGroup.months.map((group) => <div className={styles.thoughtMonth} key={group.key}>
                  <h3 className={styles.thoughtMonthRail} id={`month-${group.key}`}><span className={styles.thoughtMonthLabel}>{group.month}</span></h3>
                  <div className={styles.thoughtMonthItems}>
                    {group.items.map((item) => <div className={styles.thoughtTimelineRow} key={item.id}>
                      <time className={styles.thoughtDateMarker} dateTime={item.publishedAt ?? item.createdAt} aria-label={`${group.label} ${item.day}`}>
                        <span aria-hidden="true" />
                        <strong>{item.day}</strong>
                      </time>
                      <article className={styles.thoughtListCard}>
                        <div className={styles.thoughtListTop}>
                          <h3><Link href={item.href}>{item.title || "A thought"}</Link></h3>
                          <div><span>{tagLabel(item.tags)}</span><time dateTime={item.publishedAt ?? item.createdAt}>{formatThoughtDate(item.publishedAt ?? item.createdAt)}</time></div>
                        </div>
                        <ThoughtPreview item={item} />
                        <footer>
                          <ThoughtActions item={item} />
                          <Link className={styles.thoughtReadLink} href={item.href}>Full thought <ArrowRight size={14} aria-hidden="true" /></Link>
                        </footer>
                      </article>
                    </div>)}
                  </div>
                </div>)}
              </div>
            </section>)}
          </div> : <p className={styles.thoughtEmpty}>No more thoughts have been published yet.</p>}

          <div className={styles.paginationSurface}>
            <nav className={styles.pagination} aria-label="Thought pages">
              <button className={styles.pageButton} type="button" onClick={() => void goToPage(archive.pagination.page - 1)} disabled={isLoading || archive.pagination.page === 1}>Previous</button>
              <span className={styles.pageStatus}>Page {archive.pagination.page} of {archive.pagination.totalPages}</span>
              <button className={styles.pageButton} type="button" onClick={() => void goToPage(archive.pagination.page + 1)} disabled={isLoading || archive.pagination.page === archive.pagination.totalPages}>Next</button>
            </nav>
          </div>
          {pageError && <p className={styles.errorBanner}>The next thought page could not be loaded.</p>}
        </section>
      </Reveal>}
    </div>
  </main>;
}
