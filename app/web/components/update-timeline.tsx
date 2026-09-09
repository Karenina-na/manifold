"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatDate } from "../lib/api";
import type { UpdateTimeline, UpdateTimelineMonth, UpdateTimelinePoint } from "../lib/update-timeline";
import styles from "../app/site.module.css";

const SEASON_OF_MONTH: Record<number, number> = { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1, 6: 2, 7: 2, 8: 2, 9: 3, 10: 3, 11: 3, 12: 0 };
const SEASON_LABELS = ["Winter", "Spring", "Summer", "Autumn"];
// Minimum horizontal room (px) each month label or node date needs to stay readable.
const LABEL_GAP_PX = 44;
const DAY_MS = 86_400_000;
// Finest zoom window, in days, anchored to the newest content date.
const MIN_WINDOW_DAYS = 7;

function monthIndex(key: string) {
  const [year, month] = key.split("-").map(Number);
  return year * 12 + month - 1;
}

function monthStartTs(key: string) {
  const [year, month] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, 1);
}

function monthDays(key: string) {
  const [year, month] = key.split("-").map(Number);
  return Date.UTC(year, month, 1) - Date.UTC(year, month - 1, 1);
}

function timelineDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function windowDateLabel(ts: number) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(ts));
}

function pointLabel(point: UpdateTimelinePoint) {
  const count = point.updates.length;
  return `${count} ${count === 1 ? "update" : "updates"} on ${formatDate(point.date)}`;
}

function computeLabelStep(count: number, width: number) {
  if (!width || count <= 1) return 1;
  const spacing = width / (count - 1);
  return Math.max(1, Math.ceil(LABEL_GAP_PX / spacing));
}

interface SeasonBand {
  season: number;
  left: number;
  width: number;
}

function buildSeasonBands(months: UpdateTimelineMonth[]): SeasonBand[] {
  if (!months.length) return [];
  const bands: SeasonBand[] = [];
  let start = 0;
  let season = SEASON_OF_MONTH[Number(months[0].key.split("-")[1])] ?? 0;
  for (let index = 1; index <= months.length; index += 1) {
    const nextSeason = index < months.length ? SEASON_OF_MONTH[Number(months[index].key.split("-")[1])] ?? 0 : -1;
    if (nextSeason === season && index < months.length) continue;
    const last = months[index - 1];
    const next = index < months.length ? months[index] : null;
    const monthWidth = next ? next.position - last.position : (months.length > 1 ? last.position - months[months.length - 2].position : 100);
    bands.push({ season, left: months[start].position, width: Math.min(100 - months[start].position, last.position + monthWidth - months[start].position) });
    season = nextSeason;
    start = index;
  }
  return bands;
}

export function UpdateTimelineView({ timeline, hint }: { timeline: UpdateTimeline; hint?: string }) {
  const railRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);
  const [pinnedPointId, setPinnedPointId] = useState<string | null>(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  // Map-scale zoom: 0 = entire range, 100 = finest window (MIN_WINDOW_DAYS).
  const [zoom, setZoom] = useState(100);
  const [trackWidth, setTrackWidth] = useState(0);
  const activePointId = pinnedPointId ?? hoveredPointId;

  // Window is anchored to the newest content date; everything inside it is
  // re-stretched to fill the whole track (map-zoom, not clipping).
  const endTs = Math.max(...timeline.points.map((point) => new Date(point.date).getTime()));
  const minMonthTs = timeline.months.length ? monthStartTs(timeline.months[0].key) : endTs;
  const totalDays = Math.max(1, Math.round((endTs - minMonthTs) / DAY_MS) + 1);
  const windowDays = Math.max(1, Math.round(MIN_WINDOW_DAYS + (totalDays - MIN_WINDOW_DAYS) * (1 - zoom / 100)));
  const startTs = endTs - (windowDays - 1) * DAY_MS;
  const spanMs = Math.max(1, endTs - startTs);

  const windowMonths = timeline.months
    .filter((month) => {
      const start = monthStartTs(month.key);
      return start <= endTs && start + monthDays(month.key) >= startTs;
    })
    .map((month) => ({
      ...month,
      position: Math.max(0, Math.min(100, ((monthStartTs(month.key) - startTs) / spanMs) * 100)),
    }));

  const windowPoints = timeline.points
    .map((point) => ({ ...point, ts: new Date(point.date).getTime() }))
    .filter((point) => point.ts >= startTs && point.ts <= endTs)
    .map((point) => ({ ...point, position: ((point.ts - startTs) / spanMs) * 100 }));

  const seasonBands = buildSeasonBands(windowMonths);
  const monthStep = computeLabelStep(windowMonths.length, trackWidth);
  const windowLabel = zoom === 0 ? "All time" : windowDays >= 30 ? `Last ${Math.round(windowDays / 30.44)}mo` : `Last ${windowDays}d`;

  useEffect(() => {
    if (!trackRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setTrackWidth(width);
    });
    observer.observe(trackRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pinnedPointId && !rangeOpen) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!railRef.current?.contains(event.target as Node)) {
        setPinnedPointId(null);
        setRangeOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPinnedPointId(null);
        setRangeOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [pinnedPointId, rangeOpen]);

  if (!timeline.points.length) return <p className={styles.muted}>No content updates yet.</p>;

  return <div ref={railRef} className={styles.updateTimeline} aria-label="Content updates timeline">
    <div className={styles.updateRailHeader}>
      <div><span className={styles.eyebrow}>Updates</span><h2 id="updates-heading" className={styles.updateTitle}>Sequence</h2></div>
      <div className={styles.updateRailActions}>
        {hint && <span className={styles.sectionHint}>{hint}</span>}
        <div className={styles.updateRangeWrap}>
          <button
            className={styles.updateRangeButton}
            type="button"
            aria-expanded={rangeOpen}
            aria-haspopup="dialog"
            onClick={() => setRangeOpen((open) => !open)}
          >
            <span>{windowLabel}</span>
            <ChevronDown size={12} aria-hidden="true" />
          </button>
          {rangeOpen && <div className={styles.updateRangePanel} role="dialog" aria-label="Zoom updates timeline">
            <span className={styles.updateRangeValues}>{windowDateLabel(startTs)} – {windowDateLabel(endTs)}</span>
            <div className={styles.updateRangeSliderTrack}>
              <input
                className={styles.zoomSlider}
                type="range"
                min={0}
                max={100}
                step={1}
                value={zoom}
                aria-label="Zoom level"
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </div>
            <div className={styles.updateRangeRow}>
              <span className={styles.updateRangeHint}>All history</span>
              <button className={styles.updateRangeReset} type="button" onClick={() => setZoom(100)}>Reset</button>
            </div>
          </div>}
        </div>
      </div>
    </div>
    <div ref={trackRef} className={styles.updateTrack}>
      <span className={styles.updateTrackLine} data-update-track-line aria-hidden="true" />
      {seasonBands.map((band) => <span className={styles.updateSeasonBand} data-season={band.season} key={`${band.season}-${band.left}`} style={{ left: `${band.left}%`, width: `${band.width}%` }} aria-hidden="true">{band.width > 9 && <span className={styles.updateSeasonLabel}>{SEASON_LABELS[band.season]}</span>}</span>)}
      {windowMonths.map((month, index) => (index % monthStep === 0 || index === windowMonths.length - 1 ? <span className={styles.updateMonth} data-update-month key={month.key} style={{ left: `${month.position}%` }}><span>{month.label}</span></span> : null))}
      {windowPoints.map((point, index) => {
        const isOpen = activePointId === point.id;
        const isPinned = pinnedPointId === point.id;
        const previousPosition = windowPoints[index - 1]?.position ?? point.position;
        const nextPosition = windowPoints[index + 1]?.position ?? point.position;
        const closestGap = Math.min(Math.abs(point.position - previousPosition), Math.abs(nextPosition - point.position));
        const isSingle = windowPoints.length === 1;
        const showDate = isSingle || !trackWidth || closestGap * trackWidth / 100 >= LABEL_GAP_PX;
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
          <div className={styles.updateDate} data-update-date data-hidden={showDate ? undefined : "true"}>{timelineDate(point.date)}</div>
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
    {!windowPoints.length && <p className={styles.muted}>No updates in the selected window.</p>}
  </div>;
}
