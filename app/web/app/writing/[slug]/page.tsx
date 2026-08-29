import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ArticleMeta } from "../../../components/article-meta";
import { ArticleReadingShell } from "../../../components/article-reading-shell";
import { ArticleDiscussion } from "../../../components/comment-thread";
import { MarkdownContent } from "../../../components/markdown-content";
import { createServerClient } from "../../../lib/api";
import styles from "../../site.module.css";
import type { ArticleMetadata } from "@manifold/contracts";

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
  if (!content) return <main className={styles.page}><div className={styles.shell}><section className={styles.section}><Link href="/writing"><ArrowLeft size={15} /> Back to writing</Link><h1>That piece is not here.</h1><p className={styles.muted}>It may be unpublished or the link may have changed.</p></section></div></main>;
  if (content.kind !== "ARTICLE") notFound();
  const metadata = content.metadata as ArticleMetadata;
  const contentSlug = content.slug ?? content.id;
  return <main className={styles.page}><article className={styles.articleSurface}><div className={styles.articleSurfaceInner}><div className={styles.articleBack}><Link href="/writing"><ArrowLeft size={15} /> Back to writing</Link></div><section className={styles.articleTitleBlock}><header className={styles.articleHeader}><span className={styles.eyebrow}>Writing</span><h1>{content.title || "A writing"}</h1><p>{content.summary}</p><ArticleMeta date={content.publishedAt ?? content.createdAt} metadata={metadata} viewCount={content.viewCount} likeCount={content.likeCount} tags={content.tags} slug={contentSlug} /></header></section><ArticleReadingShell toc={metadata.toc ?? []} slug={contentSlug} discussion={<ArticleDiscussion slug={contentSlug} viewCount={content.viewCount} likeCount={content.likeCount} />}><div className={styles.articleBodyBlock}><MarkdownContent content={content.body} headingIds={(metadata.toc ?? []).map((item) => item.id)} hideFirstH1 /></div></ArticleReadingShell></div></article></main>;
}
