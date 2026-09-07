import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CommentsSection } from "../../../components/comment-thread";
import { ThoughtActions } from "../../../components/thought-actions";
import { AnchorBadge } from "../../../components/anchor-badge";
import { createServerClient, loadSiteData } from "../../../lib/api";
import { ThoughtSurface } from "@manifold/render";
import styles from "../../site.module.css";

type Props = { params: Promise<{ slug: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const content = await createServerClient().contentBySlug(slug, { trackView: false }).catch(() => null);
  if (!content) return { title: "Thoughts" };
  return { title: content.title || "A thought", description: content.summary, alternates: { canonical: `/thoughts/${content.slug}` }, openGraph: { title: content.title || "A thought", description: content.summary, type: "article" } };
}

export default async function ThoughtDetailPage({ params }: Props) {
  const { slug } = await params;
  const referer = (await headers()).get("referer") ?? undefined;
  const visitorId = (await cookies()).get("manifold-vid")?.value;
  const content = await createServerClient().contentBySlug(slug, { referrer: referer }, visitorId).catch(() => null);
  if (!content || content.kind !== "THOUGHT") notFound();
  const metadata = content.metadata;
  const contentSlug = content.slug;
  const site = await loadSiteData();
  return <main className={styles.page}>
    <article className="articleSurface">
      <div className="articleSurfaceInner thoughtDetail">
        <div className="articleBack"><Link href="/thoughts"><ArrowLeft size={15} /> Back to thoughts</Link><AnchorBadge latestAnchor={content.latestAnchor} /></div>
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
        />
        {site?.commentsEnabled === false ? null : <CommentsSection slug={contentSlug} viewCount={content.viewCount} likeCount={content.likeCount} />}
      </div>
    </article>
  </main>;
}
