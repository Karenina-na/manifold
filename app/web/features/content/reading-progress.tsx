"use client";

// Thin reading-progress bar fixed to the top of article pages. Tracks overall
// document scroll; rAF-throttled so the width state only updates once per frame.
import { useEffect, useState } from "react";
import styles from "../../app/site.module.css";

export function ReadingProgress() {
  const [width, setWidth] = useState("0%");

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const doc = document.documentElement;
        const scrollable = doc.scrollHeight - window.innerHeight;
        const ratio = scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 0;
        setWidth(`${ratio * 100}%`);
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return <div className={styles.readingProgress} style={{ width }} aria-hidden="true" />;
}
