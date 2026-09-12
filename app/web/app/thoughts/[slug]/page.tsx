import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArticleLightbox } from "../../../components/article-lightbox";
import { ReadingProgress } from "../../../components/reading-progress";
import { CommentsSection } from "../../../components/comment-thread";
import { ThoughtActions } from "../../../components/thought-actions";
import { AnchorBadge } from "../../../components/anchor-badge";
import { BackLink } from "../../../components/back-link";
import { loadContentDetail, loadSiteData } from "../../../lib/api";
import { ThoughtSurface } from "@manifold/render";
import styles from "../../site.module.css";

type Props = { params: Promise<{ slug: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const referrer = (await headers()).get("referer") ?? undefined;
  const visitorId = (await cookies()).get("manifold-vid")?.value;
  const content = await loadContentDetail(slug, referrer, visitorId);
  if (!content) return { title: "Thoughts" };
  return { title: content.title || "A thought", description: content.summary, alternates: { canonical: `/thoughts/${content.slug}` }, openGraph: { title: content.title || "A thought", description: content.summary, type: "article" } };
}

export default async function ThoughtDetailPage({ params }: Props) {
  const { slug } = await params;
  const referrer = (await headers()).get("referer") ?? undefined;
  const visitorId = (await cookies()).get("manifold-vid")?.value;
  const host = (await headers()).get("host");
  const canGoBack = !!referrer && !!host && (() => { try { return new URL(referrer).host === host; } catch { return false; } })();
  const content = await loadContentDetail(slug, referrer, visitorId);
  if (!content || content.kind !== "THOUGHT") notFound();
  const metadata = content.metadata;
  const contentSlug = content.slug;
  const site = await loadSiteData();
  return <main className={styles.page} data-route="thought">
    <article className="articleSurface">
      <div className="articleSurfaceInner thoughtDetail">
        <div className="articleBack"><BackLink href="/thoughts" label="Back to thoughts" canGoBack={canGoBack} /></div>
        <ThoughtSurface
          title={content.title || "A thought"}
          summary={content.summary}
           date={content.publishedAt}
          mood={metadata.mood}
          tags={content.tags}
          question={metadata.question}
          context={metadata.context}
          source={metadata.source}
          body={content.body}
          progress
          actions={<ThoughtActions item={content} />}
          meta={<AnchorBadge latestAnchor={content.latestAnchor} />}
        />
        {site?.commentsEnabled === false ? null : <CommentsSection slug={contentSlug} viewCount={content.viewCount} likeCount={content.likeCount} />}
      </div>
    </article>
    <ReadingProgress />
    <ArticleLightbox />
  </main>;
}
