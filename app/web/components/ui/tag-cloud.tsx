"use client";

import type { ReactNode } from "react";
import type { TagSummary } from "@manifold/contracts";
import { Tag } from "lucide-react";
import { orderSelectedFirst } from "../../features/archive/tag-order";
import styles from "../../app/site.module.css";
import { useLocale } from "../layout/i18n-provider";

type TagCloudProps = {
  tags: TagSummary[];
  activeTags: string[];
  onToggle: (name: string) => void;
  action?: ReactNode;
};

export function TagCloud({ tags, activeTags, onToggle, action }: TagCloudProps) {
  const { t } = useLocale();
  return <div className={styles.tagCloud}>
    <div className={styles.asideLabel}><Tag size={14} aria-hidden="true" /> {t("archive.tags")}</div>
    {orderSelectedFirst(tags, activeTags).map((item) => <button className={activeTags.includes(item.name) ? styles.tagPillActive : styles.tagPill} key={item.name} onClick={() => onToggle(item.name)}>{item.name} <small>{item.count}</small></button>)}
    {action}
  </div>;
}
