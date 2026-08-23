import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Calendar, Tag } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { CommentThread } from "../../../components/comment-thread";
import { createServerClient, formatDate } from "../../../lib/api";
import styles from "../../site.module.css";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const content = await createServerClient().contentBySlug(slug).catch(() => null);
  if (!content) return { title: "Writing" };
  return { title: content.title, description: content.summary, alternates: { canonical: `/writing/${content.slug}` }, openGraph: { title: content.title, description: content.summary, type: "article" } };
}

export default async function WritingDetailPage({ params }: Props) {
  const { slug } = await params;
  const content = await createServerClient().contentBySlug(slug).catch(() => null);
  if (!content) return <main className={styles.page}><div className={styles.shell}><section className={styles.section}><Link href="/writing"><ArrowLeft size={15} /> Back to writing</Link><h1>That piece is not here.</h1><p className={styles.muted}>It may be unpublished or the link may have changed.</p></section></div></main>;
  return <main className={styles.page}><article className={styles.shell}><section className={styles.section}><Link href="/writing"><ArrowLeft size={15} /> Back to writing</Link><div className={styles.articleHeader}><span className={styles.eyebrow}>{content.kind}</span><h1>{content.title}</h1><p>{content.summary}</p><div className={styles.articleMeta}><span><Calendar size={14} /> {formatDate(content.publishedAt ?? content.createdAt)}</span>{content.tags.map((tag) => <span key={tag}><Tag size={14} /> {tag}</span>)}</div></div><div className={styles.markdown}><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{content.body}</ReactMarkdown></div><CommentThread slug={content.slug} /></section></article></main>;
}
