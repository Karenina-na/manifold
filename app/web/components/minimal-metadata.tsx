"use client";

import { useEffect, useState } from "react";
import { CloudSun, GitCommitHorizontal } from "lucide-react";
import styles from "../app/site.module.css";

export type MetadataAnchor = { id: string; label: string; target: string; preview: string };

type MinimalMetadataProps = {
  anchors: MetadataAnchor[];
  focus?: string;
  location?: string;
  gitSha?: string;
};

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function formatTime(date: Date) {
  return `${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(date)} · UTC+8`;
}

export function MinimalMetadata({ anchors, focus = "Open focus", location = "Shanghai", gitSha = "local" }: MinimalMetadataProps) {
  const [time, setTime] = useState("--:--:-- · UTC+8");
  const [progress, setProgress] = useState(0);
  const [markerPositions, setMarkerPositions] = useState<number[]>(anchors.map((_, index) => index / Math.max(1, anchors.length - 1)));
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const updateTime = () => setTime(formatTime(new Date()));
    updateTime();
    const timer = window.setInterval(updateTime, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let frame = 0;

    const updateProgress = () => {
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const nextProgress = clamp(window.scrollY / maxScroll);
      const documentHeight = Math.max(1, document.documentElement.scrollHeight);
      const nextPositions = anchors.map(({ target }) => {
        const element = document.getElementById(target);
        if (!element) return 0;
        return clamp((element.getBoundingClientRect().top + window.scrollY) / documentHeight);
      });
      let nextActiveIndex = 0;
      const activeScrollPosition = window.scrollY + window.innerHeight * 0.35;
      anchors.forEach(({ target }, index) => {
        const element = document.getElementById(target);
        if (element && activeScrollPosition >= element.getBoundingClientRect().top + window.scrollY) nextActiveIndex = index;
      });
      setProgress(nextProgress);
      setMarkerPositions(nextPositions);
      setActiveIndex(nextActiveIndex);
    };

    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateProgress);
    };

    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [anchors]);

  return <aside className={styles.minimalMetadata} data-minimal-metadata aria-label="Page metadata">
    <span className={styles.metadataClock} data-metadata-clock>{time}</span>
    <span className={styles.metadataTelemetry} data-metadata-telemetry aria-label={`Live status: ${focus}, ${location}, commit ${gitSha}`}>
      <span className={styles.telemetryItem}><span className={styles.telemetryOnlineDot} aria-hidden="true" /> LIVE</span>
      <span className={styles.telemetryItem}>FOCUS · {focus}</span>
      <span className={styles.telemetryItem}><CloudSun size={11} aria-hidden="true" /> {location} · UTC+8</span>
      <span className={styles.telemetryItem}><GitCommitHorizontal size={11} aria-hidden="true" /> HEAD · {gitSha}</span>
    </span>
    <nav className={styles.metadataProgress} aria-label="Page sections">
      <span className={styles.metadataTrack} aria-hidden="true"><span className={styles.metadataTrackFill} data-metadata-progress style={{ height: `${progress * 100}%` }} /></span>
      {anchors.map((anchor, index) => <a
        className={`${styles.metadataMarker} ${index === activeIndex ? styles.metadataMarkerActive : ""}`}
        data-metadata-marker
        data-active={index === activeIndex ? "true" : "false"}
        href={`#${anchor.target}`}
        key={anchor.id}
        aria-label={`Jump to ${anchor.label}`}
        aria-describedby={`metadata-preview-${anchor.id}`}
        aria-current={index === activeIndex ? "location" : undefined}
        style={{ top: `${markerPositions[index] * 100}%` }}
      >{anchor.id}<span className={styles.metadataPreview} id={`metadata-preview-${anchor.id}`} data-metadata-preview role="tooltip"><strong>{anchor.label}</strong><small>{anchor.preview}</small><code>#{anchor.target}</code></span></a>)}
    </nav>
  </aside>;
}
