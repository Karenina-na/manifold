import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Calendar, Tag } from "lucide-react";
import { CommentThread } from "../../../components/comment-thread";
import { MarkdownContent } from "../../../components/markdown-content";
import { ReactionBar } from "../../../components/reaction-bar";
import { createServerClient, formatDate } from "../../../lib/api";
import styles from "../../site.module.css";
import type { ArticleMetadata, ContentDetail, ThoughtMetadata } from "@manifold/contracts";

type Props = { params: Promise<{ slug: string }> };

function MetadataBlock({ content }: { content: ContentDetail }) {
  if (content.kind === "THOUGHT") { const metadata = content.metadata as ThoughtMetadata; return <div className={styles.articleMeta}>{metadata.mood && <span>Mood: {metadata.mood}</span>}{metadata.question && <span>Question: {metadata.question}</span>}{metadata.source && <span>Source: {metadata.source}</span>}</div>; }
  const metadata = content.metadata as ArticleMetadata;
  return <div className={styles.articleMeta}>{metadata.readingMinutes && <span>{metadata.readingMinutes} min read</span>}{metadata.language && <span>{metadata.language}</span>}{metadata.technologies?.map((technology) => <span key={technology}>{technology}</span>)}</div>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const content = await createServerClient().contentBySlug(slug).catch(() => null);
  if (!content) return { title: "Writing" };
  return { title: content.title || "Thought", description: content.summary, alternates: { canonical: `/writing/${content.slug || content.id}` }, openGraph: { title: content.title || "Thought", description: content.summary, type: "article" } };
}

export default async function WritingDetailPage({ params }: Props) {
  const { slug } = await params;
  const content = await createServerClient().contentBySlug(slug).catch(() => null);
  if (!content) return <main className={styles.page}><div className={styles.shell}><section className={styles.section}><Link href="/writing"><ArrowLeft size={15} /> Back to writing</Link><h1>That piece is not here.</h1><p className={styles.muted}>It may be unpublished or the link may have changed.</p></section></div></main>;
  const toc = content.kind === "ARTICLE" ? content.metadata.toc ?? [] : [];
  return <main className={styles.page}><article className={styles.shell}><section className={styles.section}><Link href={content.kind === "THOUGHT" ? "/thoughts" : "/writing"}><ArrowLeft size={15} /> Back</Link><div className={styles.articleHeader}><span className={styles.eyebrow}>{content.kind}</span><h1>{content.title || "A thought"}</h1><p>{content.summary}</p><div className={styles.articleMeta}><span><Calendar size={14} /> {formatDate(content.publishedAt ?? content.createdAt)}</span>{content.tags.map((tag) => <span key={tag}><Tag size={14} /> {tag}</span>)}</div><MetadataBlock content={content} /></div><div className={toc.length ? styles.articleLayout : undefined}>{toc.length > 0 && <aside className={styles.toc} aria-label="Table of contents"><span className={styles.eyebrow}>On this page</span>{toc.map((item) => <a key={item.id} href={`#${item.id}`} className={item.level === 3 ? styles.tocNested : undefined}>{item.label}</a>)}</aside>}<div className={styles.markdown}><MarkdownContent content={content.body} /></div></div><ReactionBar slug={content.slug ?? content.id} /><CommentThread slug={content.slug ?? content.id} /></section></article></main>;
}
