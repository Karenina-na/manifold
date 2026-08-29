"use client";

import { useEffect, useState } from "react";
import styles from "../app/site.module.css";

export function ReadingProgress({ label = "Reading" }: { label?: string }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return <aside className={styles.articleToc} aria-label="Reading progress">
    <div className={styles.articleTocHeading}><span>{label}</span><span>{Math.round(progress * 100)}%</span></div>
    <div className={styles.articleTocTrack} aria-hidden="true"><span style={{ height: `${progress * 100}%` }} /></div>
  </aside>;
}
