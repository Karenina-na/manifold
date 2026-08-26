"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup } from "framer-motion";
import type { ArticleMetadata } from "@manifold/contracts";
import styles from "../app/site.module.css";
import { CommentComposer } from "./comment-thread";

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

export function ArticleReadingShell({ children, discussion, toc, slug }: { children: React.ReactNode; discussion: React.ReactNode; toc: TocItem[]; slug: string }) {
  const discussionEndRef = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(false);
  const [compactExpanded, setCompactExpanded] = useState(false);
  const [bottomExpanded, setBottomExpanded] = useState(true);
  useEffect(() => {
    if (!discussionEndRef.current) return;
    const observer = new IntersectionObserver(([entry]) => setAtEnd(entry.isIntersecting), { rootMargin: "0px 0px -24% 0px", threshold: 0.1 });
    observer.observe(discussionEndRef.current);
    return () => observer.disconnect();
  }, []);

  return <LayoutGroup id="article-reading-actions"><div className={styles.articleReadingShell}>
    <aside className={styles.articleActionRail} aria-label="Article actions">
      <AnimatePresence initial={false} mode="popLayout">{!atEnd && <CommentComposer slug={slug} compact expanded={compactExpanded} onExpandedChange={setCompactExpanded} />}</AnimatePresence>
    </aside>
    <div className={styles.articleReadingMain}>{children}</div>
    {toc.length > 0 && <ArticleToc items={toc} />}
    <section className={styles.articleDiscussionBlock} aria-label="Article discussion">
      {discussion}
      <div ref={discussionEndRef} className={styles.articleComposerTrigger} aria-hidden="true" />
    </section>
    <AnimatePresence initial={false} mode="popLayout">{atEnd && <section className={styles.articleComposerBlock} aria-label="Add a comment">
      <CommentComposer slug={slug} expanded={bottomExpanded} onExpandedChange={setBottomExpanded} />
    </section>}</AnimatePresence>
  </div></LayoutGroup>;
}
