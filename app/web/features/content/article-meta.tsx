"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Clock3, Eye, Heart, Languages } from "lucide-react";
import { useState } from "react";
import type { ArticleMetadata } from "@manifold/contracts";
import { createBrowserClient, formatDate, getVisitorId } from "../../lib/api";
import { useLocale } from "../../components/layout/i18n-provider";

type ArticleMetaProps = {
  date: string;
  metadata: ArticleMetadata;
  viewCount: number;
  likeCount: number;
  tags: string[];
  slug: string;
  children?: React.ReactNode;
};

export function ArticleMeta({ date, metadata, viewCount, likeCount, tags, slug, children }: ArticleMetaProps) {
  const { locale, t } = useLocale();
  const [visitorId] = useState(() => typeof window === "undefined" ? "" : getVisitorId());
  const likesQuery = useQuery({
    queryKey: ["likes", slug, visitorId],
    queryFn: () => createBrowserClient().likes(slug, visitorId),
    enabled: Boolean(visitorId),
  });
  const currentLikeCount = likesQuery.data?.likeCount ?? likeCount;
  return <div className="articleMeta" aria-label={t("detail.articleMetadata")}>
    <span><CalendarDays size={14} aria-hidden="true" /> <time dateTime={date}>{formatDate(date, locale, t("common.unpublished"))}</time></span>
    {metadata.readingMinutes !== undefined && <span><Clock3 size={14} aria-hidden="true" /> {t("common.minRead", { count: metadata.readingMinutes })}</span>}
    {metadata.language && <span><Languages size={14} aria-hidden="true" /> {metadata.language}</span>}
    <span><Eye size={14} aria-hidden="true" /> {t("common.views", { count: viewCount })}</span>
    <span><Heart size={14} aria-hidden="true" /> {t("common.likes", { count: currentLikeCount })}</span>
    {tags.map((tag) => <span key={tag} className="articleMetaTag">#{tag}</span>)}
    {children}
  </div>;
}
