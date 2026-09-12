import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArticleLightbox } from "../../../components/article-lightbox";
import { ReadingProgress } from "../../../components/reading-progress";
import { ArticleMeta } from "../../../components/article-meta";
import { ArticleReadingShell } from "../../../components/article-reading-shell";
import { ArticleDiscussion } from "../../../components/comment-thread";
import { AnchorBadge } from "../../../components/anchor-badge";
import { BackLink } from "../../../components/back-link";
import { MarkdownContent } from "@manifold/render";
import { loadContentDetail, loadSiteData } from "../../../lib/api";
import styles from "../../site.module.css";

type Props = { params: Promise<{ slug: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const referrer = (await headers()).get("referer") ?? undefined;
  const visitorId = (await cookies()).get("manifold-vid")?.value;
  const content = await loadContentDetail(slug, referrer, visitorId);
  if (!content) return { title: "Writing" };
  return { title: content.title || "A writing", description: content.summary, alternates: { canonical: `/writing/${content.slug}` }, openGraph: { title: content.title || "A writing", description: content.summary, type: "article" } };
}

export default async function WritingDetailPage({ params }: Props) {
  const { slug } = await params;
  const referrer = (await headers()).get("referer") ?? undefined;
  const visitorId = (await cookies()).get("manifold-vid")?.value;
  const host = (await headers()).get("host");
  const canGoBack = !!referrer && !!host && (() => { try { return new URL(referrer).host === host; } catch { return false; } })();
  const content = await loadContentDetail(slug, referrer, visitorId);
  if (!content || content.kind !== "ARTICLE") notFound();
  const metadata = content.metadata;
  const contentSlug = content.slug;
  const toc = metadata.toc;
  const site = await loadSiteData();
  const discussion = site?.commentsEnabled === false ? null : <ArticleDiscussion slug={contentSlug} viewCount={content.viewCount} likeCount={content.likeCount} />;
  return <main className={styles.page} data-route="writing"><article className="articleSurface"><div className="articleSurfaceInner"><div className="articleBack"><BackLink href="/writing" label="Back to writing" canGoBack={canGoBack} /></div><section className="articleTitleBlock"><header className="articleHeader"><span className="eyebrow">Writing</span><h1>{content.title || "A writing"}</h1><p>{content.summary}</p><ArticleMeta date={content.publishedAt ?? content.createdAt} metadata={metadata} viewCount={content.viewCount} likeCount={content.likeCount} tags={content.tags} slug={contentSlug}><AnchorBadge latestAnchor={content.latestAnchor} /></ArticleMeta></header></section><ArticleReadingShell slug={contentSlug} toc={toc} discussion={discussion}><div className="articleBodyBlock"><div className="markdown"><MarkdownContent content={content.body} headingIds={toc.map((item) => item.id)} hideFirstH1 /></div></div></ArticleReadingShell></div></article><ReadingProgress /><ArticleLightbox /></main>;
}
