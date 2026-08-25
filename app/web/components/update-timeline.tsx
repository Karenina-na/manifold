"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatDate } from "../lib/api";
import type { UpdateTimeline, UpdateTimelinePoint } from "../lib/update-timeline";
import styles from "../app/site.module.css";

function timelineDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function pointLabel(point: UpdateTimelinePoint) {
  const count = point.updates.length;
  return `${count} ${count === 1 ? "update" : "updates"} on ${formatDate(point.date)}`;
}

export function UpdateTimelineView({ timeline }: { timeline: UpdateTimeline }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);
  const [pinnedPointId, setPinnedPointId] = useState<string | null>(null);
  const activePointId = pinnedPointId ?? hoveredPointId;

  useEffect(() => {
    if (!pinnedPointId) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!railRef.current?.contains(event.target as Node)) setPinnedPointId(null);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPinnedPointId(null);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [pinnedPointId]);

  if (!timeline.points.length) return <p className={styles.muted}>No content updates yet.</p>;

  return <div ref={railRef} className={styles.updateTimeline} aria-label="Recent content updates timeline">
    <div className={styles.updateTrack}>
      <span className={styles.updateTrackLine} data-update-track-line aria-hidden="true" />
      {timeline.months.map((month) => <span className={styles.updateMonth} data-update-month key={month.key} style={{ left: `${month.position}%` }}><span>{month.label}</span></span>)}
      {timeline.points.map((point) => {
        const isOpen = activePointId === point.id;
        const isPinned = pinnedPointId === point.id;
        return <div
          className={styles.updateNode}
          data-update-node
          data-update-edge={point.edge}
          data-pinned={isPinned ? "true" : "false"}
          data-open={isOpen ? "true" : "false"}
          key={point.id}
          style={{ left: `${point.position}%` }}
          onMouseEnter={() => setHoveredPointId(point.id)}
          onMouseLeave={() => setHoveredPointId((current) => current === point.id ? null : current)}
        >
          <button
            className={styles.updateTrigger}
            type="button"
            data-update-trigger
            aria-expanded={isOpen}
            aria-label={pointLabel(point)}
            onClick={() => setPinnedPointId((current) => current === point.id ? null : point.id)}
          >
            <span className={styles.updateDot} data-update-dot aria-hidden="true" />
          </button>
          <div className={styles.updateDate} data-update-date>{timelineDate(point.date)}</div>
          <div className={styles.updatePreview} data-update-preview data-open={isOpen ? "true" : "false"} aria-hidden={!isOpen}>
            <span className={styles.updatePreviewMeta}>{formatDate(point.date)} · {point.updates.length} {point.updates.length === 1 ? "update" : "updates"}</span>
            <span className={styles.updatePreviewList}>
              {point.updates.map((entry) => <Link className={styles.updatePreviewItem} href={entry.href} key={entry.id} tabIndex={isOpen ? 0 : -1}>
                <span className={styles.updatePreviewItemMeta}>{entry.kind === "ARTICLE" ? "WRITING" : "THOUGHT"} · {formatDate(entry.date)}</span>
                <strong>{entry.title}</strong>
                <span>{entry.summary}</span>
              </Link>)}
            </span>
          </div>
        </div>;
      })}
    </div>
  </div>;
}
