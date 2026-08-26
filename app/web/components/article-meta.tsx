"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Clock3, Eye, Heart, Languages } from "lucide-react";
import { useState } from "react";
import type { ArticleMetadata } from "@manifold/contracts";
import { createBrowserClient, getVisitorId } from "../lib/api";
import styles from "../app/site.module.css";

type ArticleMetaProps = {
  date: string;
  metadata: ArticleMetadata;
  viewCount: number;
  likeCount: number;
  tags: string[];
  slug: string;
};

export function ArticleMeta({ date, metadata, viewCount, likeCount, tags, slug }: ArticleMetaProps) {
  const [visitorId] = useState(() => typeof window === "undefined" ? "" : getVisitorId());
  const likesQuery = useQuery({
    queryKey: ["likes", slug, visitorId],
    queryFn: () => createBrowserClient().likes(slug, visitorId),
    enabled: Boolean(visitorId),
  });
  const currentLikeCount = likesQuery.data?.likeCount ?? likeCount;
  return <div className={styles.articleMeta} aria-label="Article metadata">
    <span><CalendarDays size={14} aria-hidden="true" /> <time dateTime={date}>{new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", year: "numeric" }).format(new Date(date))}</time></span>
    {metadata.readingMinutes !== undefined && <span><Clock3 size={14} aria-hidden="true" /> {metadata.readingMinutes} min read</span>}
    {metadata.language && <span><Languages size={14} aria-hidden="true" /> {metadata.language}</span>}
    <span><Eye size={14} aria-hidden="true" /> {viewCount}</span>
    <span><Heart size={14} aria-hidden="true" /> {currentLikeCount}</span>
    {tags.map((tag) => <span key={tag} className={styles.articleMetaTag}>#{tag}</span>)}
  </div>;
}
