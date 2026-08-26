"use client";

import { MessageCircle, Share2 } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { ArticleMetadata } from "@manifold/contracts";
import { ReactionBar } from "./reaction-bar";
import styles from "../app/site.module.css";

type TocItem = NonNullable<ArticleMetadata["toc"]>[number];

function ArticleToc({ items }: { items: TocItem[] }) {
  const [activeId, setActiveId] = useState(items[0]?.id ?? "");
  const [progress, setProgress] = useState(0);
  const activeIdRef = useRef(items[0]?.id ?? "");
  useEffect(() => {
    const headings = Array.from(document.querySelectorAll<HTMLElement>("[data-content-heading]"));
    const update = () => {
      const threshold = 170;
      const current = headings.reduce((selected, heading) => heading.getBoundingClientRect().top <= threshold ? heading.id : selected, "");
      const nextId = current || items[0]?.id || "";
      if (nextId !== activeIdRef.current) {
        activeIdRef.current = nextId;
        setActiveId(nextId);
      }
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [items]);
  return <aside className={styles.articleToc} aria-label="On this page">
    <div className={styles.articleTocHeading}><span>On this page</span><span>{Math.round(progress * 100)}%</span></div>
    <div className={styles.articleTocTrack} aria-hidden="true"><span style={{ height: `${progress * 100}%` }} /></div>
    <nav>{items.map((item) => <a key={item.id} href={`#${item.id}`} className={`${item.level === 3 ? styles.tocNested : ""} ${activeId === item.id ? styles.articleTocActive : ""}`} aria-current={activeId === item.id ? "location" : undefined}>{item.label}</a>)}</nav>
  </aside>;
}

export function ArticleReadingShell({ children, afterReading, toc, slug }: { children: React.ReactNode; afterReading: React.ReactNode; toc: TocItem[]; slug: string }) {
  const endRef = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(false);
  useEffect(() => {
    if (!endRef.current) return;
    const observer = new IntersectionObserver(([entry]) => setAtEnd(entry.isIntersecting), { threshold: 0.15 });
    observer.observe(endRef.current);
    return () => observer.disconnect();
  }, []);
  const scrollToComments = () => document.getElementById("comments-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const share = async () => {
    if (navigator.share) {
      await navigator.share({ title: document.title, url: window.location.href }).catch(() => undefined);
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(window.location.href);
    }
  };
  return <div className={styles.articleReadingShell}>
    <motion.aside layout className={`${styles.articleActionRail} ${atEnd ? styles.articleActionRailAtEnd : ""}`} aria-label="Article actions" transition={{ duration: 0.48, ease: [0.22, 1, 0.36, 1] }}>
      <div className={styles.articleActionCard}>
        <span className={styles.articleActionLabel}>Keep reading</span>
        <ReactionBar slug={slug} compact />
        <button type="button" className={styles.articleActionButton} onClick={scrollToComments}><MessageCircle size={15} /> Comment</button>
        <button type="button" className={styles.articleActionButton} onClick={share}><Share2 size={15} /> Share</button>
      </div>
    </motion.aside>
    <div className={styles.articleReadingMain}>{children}</div>
    {toc.length > 0 && <ArticleToc items={toc} />}
    <section ref={endRef} className={styles.articleEndBlock}>{afterReading}</section>
  </div>;
}
