import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArticleLightbox } from "../../../features/content/article-lightbox";
import { ReadingProgress } from "../../../features/content/reading-progress";
import { CommentsSection } from "../../../features/comments/comment-thread";
import { ThoughtActions } from "../../../features/content/thought-actions";
import { AnchorBadge } from "../../../features/content/anchor-badge";
import { BackLink } from "../../../features/content/back-link";
import { loadContentDetail, loadSiteData } from "../../../lib/api";
import { getServerI18n } from "../../../i18n/i18n-server";
import { ThoughtSurface } from "@manifold/render";
import styles from "../../site.module.css";

type Props = { params: Promise<{ slug: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ slug }, { t }] = await Promise.all([params, getServerI18n()]);
  const referrer = (await headers()).get("referer") ?? undefined;
  const visitorId = (await cookies()).get("manifold-vid")?.value;
  const content = await loadContentDetail(slug, referrer, visitorId);
  const title = content?.title || t("common.thought");
  if (!content) return { title };
  return { title, description: content.summary, alternates: { canonical: `/thoughts/${content.slug}` }, openGraph: { title, description: content.summary, type: "article" } };
}

export default async function ThoughtDetailPage({ params }: Props) {
  const [{ slug }, { t }] = await Promise.all([params, getServerI18n()]);
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
        <div className="articleBack"><BackLink href="/thoughts" label={t("detail.backThoughts")} canGoBack={canGoBack} /></div>
        <ThoughtSurface
          title={content.title || t("common.thought")}
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
