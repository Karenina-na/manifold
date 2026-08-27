"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Eye, Heart, Search, SlidersHorizontal, Tag } from "lucide-react";
import { formatDate } from "../../lib/api";
import type { Content } from "@manifold/contracts";
import styles from "../site.module.css";
import { Reveal } from "../../components/reveal";
import { previewForContent } from "../../lib/content-preview";

export default function WritingArchive({ items }: { items: Content[] | null }) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("newest");
  const [noAi, setNoAi] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [pageInput, setPageInput] = useState("1");
  const articles = items ?? [];
  const tags = useMemo(() => Array.from(new Set(articles.flatMap((item) => item.tags))).map((name) => ({ name, count: articles.filter((item) => item.tags.includes(name)).length })), [articles]);
  const filtered = useMemo(() => articles.filter((item) => `${item.title ?? ""} ${item.summary} ${item.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()) && (!tag || item.tags.includes(tag)) && (!noAi || !("aiAssisted" in item.metadata && item.metadata.aiAssisted))).sort((a, b) => { const get = (item: Content) => sort === "updated" ? item.updatedAt : (item.publishedAt ?? item.createdAt); return (sort === "oldest" ? 1 : -1) * (Date.parse(get(a)) - Date.parse(get(b))); }), [articles, noAi, query, sort, tag]);
  const totalPages = Math.max(1, Math.ceil(Math.max(0, filtered.length - 1) / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice(1).slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const goToPage = (value: number) => { const next = Math.min(totalPages, Math.max(1, value)); setPage(next); setPageInput(String(next)); };
  const featured = filtered[0];
  return <main className={styles.page}><div className={styles.writingShell}><div className={styles.writingMain}><Reveal className={styles.writingReveal}><header className={styles.writingHero}><span className={styles.eyebrow}>Writings</span><h1>Writing</h1></header></Reveal>{featured && <Reveal className={styles.writingReveal}><Link href={featured.href} className={styles.featuredCard}><div className={styles.featuredTop}><span className={styles.featuredBadge}>Featured</span><span>{formatDate(featured.publishedAt ?? featured.createdAt)}</span></div><h2>{featured.title}</h2><WritingPreview item={featured} featured /><div className={styles.featuredFooter}><span>{formatDate(featured.publishedAt ?? featured.createdAt)} · {featured.tags.map((value) => `#${value}`).join(" ")} · {featured.kind === "ARTICLE" && featured.metadata.readingMinutes ? `${featured.metadata.readingMinutes} min read` : "Article"}</span><span><Eye size={14} /> Views {featured.viewCount ?? 0} · <Heart size={14} /> Likes {featured.likeCount ?? 0}</span></div><span className={styles.featuredArrow} aria-hidden="true">→</span></Link></Reveal>}{items === null ? <p className={styles.errorBanner}>The writings could not be loaded.</p> : <Reveal className={styles.writingReveal}><section className={styles.writingCollection}><div className={styles.writingToolbarSurface}><div className={styles.writingToolbar}><span>{filtered.length} articles</span><div className={styles.toolbarControls}><button className={noAi ? styles.controlActive : styles.control} onClick={() => { setNoAi(!noAi); goToPage(1); }}><SlidersHorizontal size={14} /> No AI writing</button><select value={sort} onChange={(event) => { setSort(event.target.value); goToPage(1); }} aria-label="Sort writings"><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="updated">Recently updated</option></select></div></div></div><div className={styles.writingListSurface}><div className={styles.writingList}>{pageItems.map((item) => <Link className={styles.writingItem} key={item.id} href={item.href}><h3>{item.title}</h3><WritingPreview item={item} /><div><span>{formatDate(item.publishedAt ?? item.createdAt)}</span><span>{item.tags.map((value) => `#${value}`).join(" ")}</span><span>{item.kind === "ARTICLE" && item.metadata.readingMinutes ? `${item.metadata.readingMinutes} min read` : "Article"}</span><span><Eye size={12} /> {item.viewCount ?? 0} · <Heart size={12} /> {item.likeCount ?? 0}</span></div></Link>)}</div></div><div className={styles.paginationSurface}><nav className={styles.pagination} aria-label="Writing pages"><button className={styles.pageButton} onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1}>Previous</button><span className={styles.pageStatus}>Page {currentPage} of {totalPages}</span><button className={styles.pageButton} onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages}>Next</button></nav></div></section></Reveal>}</div><aside className={styles.writingAside}><label className={styles.writingSearch}><Search size={16} /><input value={query} onChange={(event) => { setQuery(event.target.value); goToPage(1); }} placeholder="Search writings" aria-label="Search writings" /></label><div className={styles.tagCloud}><div className={styles.asideLabel}><Tag size={14} /> Tags</div>{tags.map((item) => <button className={tag === item.name ? styles.tagPillActive : styles.tagPill} key={item.name} onClick={() => { setTag(tag === item.name ? "" : item.name); goToPage(1); }}>{item.name} <small>{item.count}</small></button>)}</div><div className={styles.archiveBlock}><div className={styles.asideLabel}>Archive</div><p>{articles.length} writings</p><Link href="#all-tags">View all tags →</Link></div></aside></div></main>;
}

function WritingPreview({ item, featured = false }: { item: Content; featured?: boolean }) {
  const preview = previewForContent(item);
  return <>
    {preview.summary && <p className={styles.writingSummary}><span aria-hidden="true">✦</span>{preview.summary}</p>}
    {preview.excerpt && <p className={featured ? styles.writingExcerptFeatured : styles.writingExcerpt}>{preview.excerpt}</p>}
  </>;
}
