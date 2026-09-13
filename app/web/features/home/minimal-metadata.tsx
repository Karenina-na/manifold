"use client";

import { useEffect, useState } from "react";
import styles from "../../app/site.module.css";
import { useLocale } from "../../components/layout/i18n-provider";

export type MetadataAnchor = { id: string; label: string; target: string; preview: string };

type MinimalMetadataProps = {
  anchors: MetadataAnchor[];
};

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function MinimalMetadata({ anchors }: MinimalMetadataProps) {
  const { t } = useLocale();
  const [progress, setProgress] = useState(0);
  const [markerPositions, setMarkerPositions] = useState<number[]>(anchors.map((_, index) => index / Math.max(1, anchors.length - 1)));
  const [activeIndex, setActiveIndex] = useState(0);

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

  return <aside className={styles.minimalMetadata} data-minimal-metadata aria-label={t("home.metadata.sections")}>
    <nav className={styles.metadataProgress} aria-label={t("home.metadata.jump")}>
      <span className={styles.metadataTrack} aria-hidden="true"><span className={styles.metadataTrackFill} data-metadata-progress style={{ height: `${progress * 100}%` }} /></span>
      {anchors.map((anchor, index) => <a
        className={`${styles.metadataMarker} ${index === activeIndex ? styles.metadataMarkerActive : ""}`}
        data-metadata-marker
        data-active={index === activeIndex ? "true" : "false"}
        href={`#${anchor.target}`}
        key={anchor.id}
        aria-label={t("home.metadata.jumpTo", { section: anchor.label })}
        aria-describedby={`metadata-preview-${anchor.id}`}
        aria-current={index === activeIndex ? "location" : undefined}
        style={{ top: `${markerPositions[index] * 100}%` }}
      ><span className={styles.metadataPreview} id={`metadata-preview-${anchor.id}`} data-metadata-preview role="tooltip"><strong>{anchor.label}</strong><small>{anchor.preview}</small><code>#{anchor.target}</code></span></a>)}
    </nav>
  </aside>;
}
