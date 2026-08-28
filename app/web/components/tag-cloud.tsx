"use client";

import type { TagSummary } from "@manifold/contracts";
import { Tag } from "lucide-react";
import styles from "../app/site.module.css";

type TagCloudProps = {
  tags: TagSummary[];
  activeTag: string;
  onToggle: (name: string) => void;
};

export function TagCloud({ tags, activeTag, onToggle }: TagCloudProps) {
  return <div className={styles.tagCloud}>
    <div className={styles.asideLabel}><Tag size={14} aria-hidden="true" /> Tags</div>
    {tags.map((item) => <button className={activeTag === item.name ? styles.tagPillActive : styles.tagPill} key={item.name} onClick={() => onToggle(item.name)}>{item.name} <small>{item.count}</small></button>)}
  </div>;
}
