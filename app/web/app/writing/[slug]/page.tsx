import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Calendar, Tag } from "lucide-react";
import { ArticleMeta } from "../../../components/article-meta";
import { ArticleReadingShell } from "../../../components/article-reading-shell";
import { CommentThread } from "../../../components/comment-thread";
import { MarkdownContent } from "../../../components/markdown-content";
import { ReactionBar } from "../../../components/reaction-bar";
import { createServerClient, formatDate } from "../../../lib/api";
import styles from "../../site.module.css";
import type { ArticleMetadata, ThoughtMetadata } from "@manifold/contracts";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const content = await createServerClient().contentBySlug(slug, { trackView: false }).catch(() => null);
  if (!content) return { title: "Writing" };
  return { title: content.title || "Thought", description: content.summary, alternates: { canonical: `/writing/${content.slug || content.id}` }, openGraph: { title: content.title || "Thought", description: content.summary, type: "article" } };
}

export default async function WritingDetailPage({ params }: Props) {
  const { slug } = await params;
  const content = await createServerClient().contentBySlug(slug).catch(() => null);
  if (!content) return <main className={styles.page}><div className={styles.shell}><section className={styles.section}><Link href="/writing"><ArrowLeft size={15} /> Back to writing</Link><h1>That piece is not here.</h1><p className={styles.muted}>It may be unpublished or the link may have changed.</p></section></div></main>;
  if (content.kind === "ARTICLE") {
    const metadata = content.metadata as ArticleMetadata;
    const slug = content.slug ?? content.id;
    return <main className={styles.page}><article className={styles.articleSurface}><div className={styles.articleSurfaceInner}><section className={styles.articleTitleBlock}><div className={styles.articleBack}><Link href="/writing"><ArrowLeft size={15} /> Back to writing</Link></div><header className={styles.articleHeader}><span className={styles.eyebrow}>Writing</span><h1>{content.title || "A writing"}</h1><p>{content.summary}</p><ArticleMeta date={content.publishedAt ?? content.createdAt} metadata={metadata} viewCount={content.viewCount} likeCount={content.likeCount} tags={content.tags} slug={slug} /></header></section><ArticleReadingShell toc={metadata.toc ?? []} slug={slug} afterReading={<div className={styles.articleEndInner}><div className={styles.articleEndHeading}><span className={styles.eyebrow}>After reading</span><h2>Leave a trace.</h2></div><CommentThread slug={slug} /></div>}><div className={styles.articleBodyBlock}><MarkdownContent content={content.body} headingIds={(metadata.toc ?? []).map((item) => item.id)} hideFirstH1 /></div></ArticleReadingShell></div></article></main>;
  }
  const metadata = content.metadata as ThoughtMetadata;
  return <main className={styles.page}><article className={styles.shell}><section className={styles.section}><Link href="/thoughts"><ArrowLeft size={15} /> Back</Link><div className={styles.articleHeader}><span className={styles.eyebrow}>Thought</span><h1>{content.title || "A thought"}</h1><p>{content.summary}</p><div className={styles.articleMeta}><span><Calendar size={14} /> {formatDate(content.publishedAt ?? content.createdAt)}</span>{content.tags.map((tag) => <span key={tag}><Tag size={14} /> {tag}</span>)}</div><div className={styles.articleMeta}>{metadata.mood && <span>Mood: {metadata.mood}</span>}{metadata.question && <span>Question: {metadata.question}</span>}{metadata.source && <span>Source: {metadata.source}</span>}</div></div><div className={styles.markdown}><MarkdownContent content={content.body} /></div><ReactionBar slug={content.slug ?? content.id} /><CommentThread slug={content.slug ?? content.id} /></section></article></main>;
}
