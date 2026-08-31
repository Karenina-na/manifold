import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ArticleMeta } from "../../../components/article-meta";
import { ArticleReadingShell } from "../../../components/article-reading-shell";
import { ArticleDiscussion } from "../../../components/comment-thread";
import { MarkdownContent } from "../../../components/markdown-content";
import { createServerClient, loadSiteData } from "../../../lib/api";
import type { ArticleMetadata } from "@manifold/contracts";
import styles from "../../site.module.css";

type Props = { params: Promise<{ slug: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const content = await createServerClient().contentBySlug(slug, { trackView: false }).catch(() => null);
  if (!content) return { title: "Writing" };
  return { title: content.title || "A writing", description: content.summary, alternates: { canonical: `/writing/${content.slug || content.id}` }, openGraph: { title: content.title || "A writing", description: content.summary, type: "article" } };
}

export default async function WritingDetailPage({ params }: Props) {
  const { slug } = await params;
  const referer = (await headers()).get("referer") ?? undefined;
  const visitorId = (await cookies()).get("manifold-vid")?.value;
  const content = await createServerClient().contentBySlug(slug, { referrer: referer, visitorId }).catch(() => null);
  if (!content) return <main className={styles.page}><div className={styles.shell}><section className={styles.section}><div className="articleBack"><Link href="/writing"><ArrowLeft size={15} /> Back to writing</Link></div><h1>That piece is not here.</h1><p className={styles.muted}>It may be unpublished or the link may have changed.</p></section></div></main>;
  if (content.kind !== "ARTICLE") notFound();
  const metadata = content.metadata as ArticleMetadata;
  const contentSlug = content.slug ?? content.id;
  const toc = metadata.toc ?? [];
  const site = await loadSiteData();
  const discussion = site?.commentsEnabled === false ? null : <ArticleDiscussion slug={contentSlug} viewCount={content.viewCount} likeCount={content.likeCount} />;
  return <main className={styles.page}><article className="articleSurface"><div className="articleSurfaceInner"><div className="articleBack"><Link href="/writing"><ArrowLeft size={15} /> Back to writing</Link></div><section className="articleTitleBlock"><header className="articleHeader"><span className="eyebrow">Writing</span><h1>{content.title || "A writing"}</h1><p>{content.summary}</p><ArticleMeta date={content.publishedAt ?? content.createdAt} metadata={metadata} viewCount={content.viewCount} likeCount={content.likeCount} tags={content.tags} slug={contentSlug} /></header></section><ArticleReadingShell slug={contentSlug} toc={toc} discussion={discussion}><div className="articleBodyBlock"><div className="markdown"><MarkdownContent content={content.body} headingIds={toc.map((item) => item.id)} hideFirstH1 /></div></div></ArticleReadingShell></div></article></main>;
}
