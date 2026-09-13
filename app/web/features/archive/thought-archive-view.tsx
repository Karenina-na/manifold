"use client";

import type { Collection, Content, TagSummary } from "@manifold/contracts";
import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Reveal } from "../../components/ui/reveal";
import { ScrollHint } from "../../components/ui/scroll-hint";
import { TagCloud } from "../../components/ui/tag-cloud";
import { TagPicker } from "../../components/ui/tag-picker";
import { ThoughtActions } from "../content/thought-actions";
import { buildHref, createBrowserClient } from "../../lib/api";
import { clampPage } from "./archive-url";
import { useArchiveFilters } from "./use-archive-filters";
import { groupThoughtsByYear, formatThoughtDate } from "./thought-archive";
import { previewForContent } from "./content-preview";
import { Pagination } from "../../components/ui/pagination";
import { DEFAULT_LOCALE, parseLocale, type Locale } from "../../i18n/locale";
import styles from "../../app/site.module.css";

type Thought = Extract<Content, { kind: "THOUGHT" }>;

const PAGE_SIZE = 8;

function tagLabel(tags: string[], fallback: string, locale: Locale) {
  return tags.length ? tags.map((tag) => `#${tag}`).join(" · ") : `#${fallback.toLocaleLowerCase(locale)}`;
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

export default function ThoughtArchiveView({ initialArchive, pinned, tags, initialQuery = "", initialTags = [] }: ThoughtArchiveProps) {
  const { t, i18n } = useTranslation();
  const locale = parseLocale(i18n.resolvedLanguage ?? i18n.language) ?? DEFAULT_LOCALE;
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
  const yearGroups = useMemo(() => groupThoughtsByYear(data?.data ?? [], locale), [data, locale]);
  const heroTotal = initialArchive?.pagination.totalItems ?? 0;
  const latestAt = initialArchive?.data[0]?.publishedAt ?? null;

  const changePage = (next: number) => {
    if (!data || isPending) return;
    goToPage(clampPage(next, data.pagination.totalPages));
  };

  return <main className={styles.page} data-route="thought">
    <div className={styles.thoughtShell}>
      <Reveal className={styles.writingReveal}>
        <header className={styles.thoughtHero}>
          <div>
            <span className={styles.eyebrow}>◇ {t("common.thoughts")}</span>
            <h1>{t("common.thoughts")}</h1>
          </div>
          <div className={styles.thoughtHeroStatus}>
            <span className={styles.chainPulse}><span className={styles.chainPulseDot} aria-hidden="true" /> In motion</span>
            <span className={styles.thoughtHeroStat}>{t("common.notes", { count: heroTotal })} · {t("common.last", { date: latestAt ? formatThoughtDate(latestAt, locale, t("common.unpublished")) : "—" })}</span>
          </div>
        </header>
      </Reveal>

      {!filtersActive && pinned.length > 0 && <Reveal className={styles.writingReveal}>
        <div className={styles.pinnedRow}>
          {pinned.map((item) => <article className={styles.featuredThought} key={item.id}>
            <div className={styles.featuredThoughtTop}>
              <span className={styles.featuredBadge}>{t("common.pinned")}</span>
              <div className={styles.featuredThoughtMeta}><span>{tagLabel(item.tags, t("common.thought"), locale)}</span><time dateTime={item.publishedAt}>{formatThoughtDate(item.publishedAt, locale, t("common.unpublished"))}</time></div>
            </div>
            <h2><Link href={buildHref(item)}>{item.title || t("archive.fallbackThought")}</Link></h2>
            <ThoughtPreview item={item} featured />
            <footer className={styles.featuredThoughtFooter}>
              <ThoughtActions item={item} />
              <Link className={styles.thoughtReadLink} href={buildHref(item)}>{t("archive.fullThought")} <ArrowRight size={15} aria-hidden="true" /></Link>
            </footer>
          </article>)}
        </div>
      </Reveal>}

      {data === null ? <p className={styles.errorBanner}>{t("archive.thoughtsLoadError")}</p> : <Reveal className={styles.writingReveal} manual={!filtersActive}>
        <section className={styles.thoughtCollection} ref={timelineRef} aria-labelledby="thought-timeline-heading">
          <div className={styles.thoughtSectionHeading}>
            <div>
              <span className={styles.eyebrow}>{t("common.archive")}</span>
              <h2 id="thought-timeline-heading">{t("archive.thoughtTimeline")}</h2>
            </div>
            <span>{t("common.notes", { count: data.pagination.totalItems })}</span>
          </div>

          <div className={`${styles.writingToolbarSurface} ${styles.thoughtFilterSurface}`}>
            <div className={styles.thoughtFilterSearch}>
              <label className={styles.writingSearch}>
                <Search size={16} aria-hidden="true" />
                <input value={input} onChange={(event) => onSearchInput(event.target.value)} placeholder={t("archive.searchThoughts")} aria-label={t("archive.searchThoughts")} />
              </label>
            </div>
            {tags?.length ? <TagCloud tags={tags} activeTags={selectedTags} onToggle={toggleTag} action={<TagPicker tags={tags} activeTags={selectedTags} onToggle={toggleTag} label={t("archive.viewAllTags")} />} /> : null}
          </div>

          {yearGroups.length ? <div className={styles.thoughtTimeline} data-pending={isPending}>
            {yearGroups.map((yearGroup) => <section className={styles.thoughtYear} key={yearGroup.year} aria-labelledby={`year-${yearGroup.year}`}>
              <header className={styles.thoughtYearHeader} id={`year-${yearGroup.year}`}>
                <strong>{yearGroup.year}</strong>
                <span className={styles.thoughtYearCount}>{t("common.notes", { count: yearGroup.months.reduce((count, group) => count + group.items.length, 0) })}</span>
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
                          <h3><Link href={buildHref(item)}>{item.title || t("archive.fallbackThought")}</Link></h3>
                          <div><span>{tagLabel(item.tags, t("common.thought"), locale)}</span><time dateTime={item.publishedAt}>{formatThoughtDate(item.publishedAt, locale, t("common.unpublished"))}</time></div>
                        </div>
                        <ThoughtPreview item={item} />
                        <footer>
                          <ThoughtActions item={item} />
                          <Link className={styles.thoughtReadLink} href={buildHref(item)}>{t("archive.fullThought")} <ArrowRight size={14} aria-hidden="true" /></Link>
                        </footer>
                      </article>
                    </div>)}
                  </div>
                </div>)}
              </div>
            </section>)}
          </div> : <p className={styles.thoughtEmpty}>{filtersActive ? t("archive.thoughtsFilteredEmpty") : t("archive.thoughtsEmpty")}</p>}

          {totalPages > 1 && <Pagination page={data.pagination.page} totalPages={totalPages} onChange={changePage} disabled={isPending} label={t("archive.thoughtPages")} />}
          {error && <p className={styles.errorBanner}>{t("archive.thoughtsPageError")}</p>}
        </section>
      </Reveal>}
    </div>
    <ScrollHint manual={!filtersActive} targetRef={timelineRef} />
  </main>;
}
