"use client";

import type { ReactNode } from "react";
import type { TagSummary } from "@manifold/contracts";
import { Tag } from "lucide-react";
import { orderSelectedFirst } from "../lib/tag-order";
import styles from "../app/site.module.css";

type TagCloudProps = {
  tags: TagSummary[];
  activeTags: string[];
  onToggle: (name: string) => void;
  action?: ReactNode;
};

export function TagCloud({ tags, activeTags, onToggle, action }: TagCloudProps) {
  return <div className={styles.tagCloud}>
    <div className={styles.asideLabel}><Tag size={14} aria-hidden="true" /> Tags</div>
    {orderSelectedFirst(tags, activeTags).map((item) => <button className={activeTags.includes(item.name) ? styles.tagPillActive : styles.tagPill} key={item.name} onClick={() => onToggle(item.name)}>{item.name} <small>{item.count}</small></button>)}
    {action}
  </div>;
}
