"use client";

import { Eye, Heart, MessageCircle } from "lucide-react";
import styles from "../../app/site.module.css";
import { useLocale } from "../../components/layout/i18n-provider";

type ThoughtActionsProps = { item: { likeCount?: number; viewCount?: number; commentCount?: number } };

export function ThoughtActions({ item }: ThoughtActionsProps) {
  const { t } = useLocale();
  return <div className={styles.thoughtActions}>
    <span><Heart size={14} aria-hidden="true" /> {t("common.likes", { count: item.likeCount ?? 0 })}</span>
    <span><Eye size={14} aria-hidden="true" /> {t("common.views", { count: item.viewCount ?? 0 })}</span>
    <span><MessageCircle size={14} aria-hidden="true" /> {t("common.comments", { count: item.commentCount ?? 0 })}</span>
  </div>;
}
