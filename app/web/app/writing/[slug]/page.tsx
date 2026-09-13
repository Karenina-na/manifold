import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArticleLightbox } from "../../../features/content/article-lightbox";
import { ReadingProgress } from "../../../features/content/reading-progress";
import { ArticleMeta } from "../../../features/content/article-meta";
import { ArticleReadingShell } from "../../../features/content/article-reading-shell";
import { ArticleDiscussion } from "../../../features/comments/comment-thread";
import { AnchorBadge } from "../../../features/content/anchor-badge";
import { BackLink } from "../../../features/content/back-link";
import { MarkdownContent } from "@manifold/render";
import { loadContentDetail, loadSiteData } from "../../../lib/api";
import { getServerI18n } from "../../../i18n/i18n-server";
import styles from "../../site.module.css";

type Props = { params: Promise<{ slug: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ slug }, { t }] = await Promise.all([params, getServerI18n()]);
  const referrer = (await headers()).get("referer") ?? undefined;
  const visitorId = (await cookies()).get("manifold-vid")?.value;
  const content = await loadContentDetail(slug, referrer, visitorId);
  const title = content?.title || t("common.writing");
  if (!content) return { title };
  return { title, description: content.summary, alternates: { canonical: `/writing/${content.slug}` }, openGraph: { title, description: content.summary, type: "article" } };
}

export default async function WritingDetailPage({ params }: Props) {
  const [{ slug }, { t }] = await Promise.all([params, getServerI18n()]);
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
  return <main className={styles.page} data-route="writing"><article className="articleSurface"><div className="articleSurfaceInner"><div className="articleBack"><BackLink href="/writing" label={t("detail.backWriting")} canGoBack={canGoBack} /></div><section className="articleTitleBlock"><header className="articleHeader"><span className="eyebrow">{t("common.writing")}</span><h1>{content.title || t("common.writing")}</h1><p>{content.summary}</p><ArticleMeta date={content.publishedAt ?? content.createdAt} metadata={metadata} viewCount={content.viewCount} likeCount={content.likeCount} tags={content.tags} slug={contentSlug}><AnchorBadge latestAnchor={content.latestAnchor} /></ArticleMeta></header></section><ArticleReadingShell slug={contentSlug} toc={toc} discussion={discussion}><div className="articleBodyBlock"><div className="markdown"><MarkdownContent content={content.body} headingIds={toc.map((item) => item.id)} hideFirstH1 /></div></div></ArticleReadingShell></div></article><ReadingProgress /><ArticleLightbox /></main>;
}
