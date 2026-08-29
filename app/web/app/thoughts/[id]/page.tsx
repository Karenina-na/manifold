import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen, CalendarDays, Compass, Sparkles, Tag } from "lucide-react";
import { CommentsSection } from "../../../components/comment-thread";
import { MarkdownContent } from "../../../components/markdown-content";
import { ThoughtActions } from "../../../components/thought-actions";
import { createServerClient, formatDate } from "../../../lib/api";
import styles from "../../site.module.css";
import type { ThoughtMetadata } from "@manifold/contracts";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const content = await createServerClient().contentBySlug(id, { trackView: false }).catch(() => null);
  if (!content) return { title: "Thoughts" };
  return { title: content.title || "A thought", description: content.summary, alternates: { canonical: `/thoughts/${content.id}` }, openGraph: { title: content.title || "A thought", description: content.summary, type: "article" } };
}

export default async function ThoughtDetailPage({ params }: Props) {
  const { id } = await params;
  const content = await createServerClient().contentBySlug(id).catch(() => null);
  if (!content || content.kind !== "THOUGHT") notFound();
  const metadata = content.metadata as ThoughtMetadata;
  const slug = content.slug ?? content.id;
  return <main className={styles.page}>
    <article className={styles.articleSurface}>
      <div className={`${styles.articleSurfaceInner} ${styles.thoughtDetail}`}>
        <div className={styles.articleBack}><Link href="/thoughts"><ArrowLeft size={15} /> Back to thoughts</Link></div>
        <section className={styles.articleTitleBlock}>
          <header className={styles.articleHeader}>
            <span className={styles.eyebrow}>Thought</span>
            <h1>{content.title || "A thought"}</h1>
            {content.summary && <p className={styles.thoughtSummary}><span aria-hidden="true">✦</span>{content.summary}</p>}
            <div className={styles.articleMeta} aria-label="Thought metadata">
              <span><CalendarDays size={14} aria-hidden="true" /> <time dateTime={content.publishedAt ?? content.createdAt}>{formatDate(content.publishedAt ?? content.createdAt)}</time></span>
              {metadata.mood && <span className={styles.thoughtMood}><Sparkles size={14} aria-hidden="true" /> {metadata.mood}</span>}
              {content.tags.map((tag) => <span key={tag}><Tag size={14} aria-hidden="true" /> {tag}</span>)}
            </div>
            <ThoughtActions item={content} />
            {metadata.question && <blockquote className={styles.thoughtReflection}>{metadata.question}</blockquote>}
            {(metadata.context || metadata.source) && <div className={styles.thoughtProvenance}>
              {metadata.context && <span><Compass size={14} aria-hidden="true" /> {metadata.context}</span>}
              {metadata.source && <span><BookOpen size={14} aria-hidden="true" /> {metadata.source}</span>}
            </div>}
          </header>
        </section>
        <div className={styles.articleBodyBlock}>
          <div className={styles.markdown}><MarkdownContent content={content.body} hideFirstH1 /></div>
        </div>
        <CommentsSection slug={slug} viewCount={content.viewCount} likeCount={content.likeCount} />
      </div>
    </article>
  </main>;
}
