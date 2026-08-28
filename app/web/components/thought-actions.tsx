import { Eye, Heart, MessageCircle } from "lucide-react";
import styles from "../app/site.module.css";

type ThoughtActionsProps = { item: { likeCount?: number; viewCount?: number; commentCount?: number } };

export function ThoughtActions({ item }: ThoughtActionsProps) {
  return <div className={styles.thoughtActions}>
    <span><Heart size={14} aria-hidden="true" /> Likes {item.likeCount ?? 0}</span>
    <span><Eye size={14} aria-hidden="true" /> Views {item.viewCount ?? 0}</span>
    <span><MessageCircle size={14} aria-hidden="true" /> Comments {item.commentCount ?? 0}</span>
  </div>;
}
