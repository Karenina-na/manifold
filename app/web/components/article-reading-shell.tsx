"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup } from "framer-motion";
import type { ArticleMetadata, Comment } from "@manifold/contracts";
import styles from "../app/site.module.css";
import { resolveArticleActionsAtEnd } from "../lib/article-end-threshold";
import { CommentComposer, ReplyContext, useReplyFocus, type ComposerPhase, type ReplyContextValue } from "./comment-thread";

type TocItem = NonNullable<ArticleMetadata["toc"]>[number];
const ARTICLE_END_ACTIVATION_RATIO = 0.76;
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
  const [replyTarget, setReplyTarget] = useState<Comment | null>(null);
  const [bottomComposerPhase, setBottomComposerPhase] = useState<ComposerPhase>("editing");
  const composerPinned = replyTarget !== null || bottomComposerPhase !== "editing";
  const showBottomComposer = atEnd || composerPinned;
  useReplyFocus(replyTarget);
  const reply = useMemo<ReplyContextValue>(() => ({ replyTarget, startReply: setReplyTarget, cancelReply: () => setReplyTarget(null) }), [replyTarget]);
  useEffect(() => {
    const trigger = discussionEndRef.current;
    if (!trigger) return;
    let frame: number | null = null;
    let currentAtEnd = false;
    let previousScrollY = window.scrollY;
    const update = () => {
      frame = null;
      const scrollY = window.scrollY;
      currentAtEnd = resolveArticleActionsAtEnd({
        atEnd: currentAtEnd,
        previousScrollY,
        scrollY,
        triggerTop: trigger.getBoundingClientRect().top,
        activationLine: window.innerHeight * ARTICLE_END_ACTIVATION_RATIO,
      });
      previousScrollY = scrollY;
      setAtEnd(currentAtEnd);
    };
    const scheduleUpdate = () => {
      if (frame === null) frame = window.requestAnimationFrame(update);
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate);
    if (resizeObserver) resizeObserver.observe(trigger.parentElement ?? trigger);
    update();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      resizeObserver?.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  return <LayoutGroup id="article-reading-actions"><ReplyContext.Provider value={reply}><div className={styles.articleReadingShell}>
    <aside className={styles.articleActionRail} aria-label="Article actions">
      <AnimatePresence initial={false} mode="popLayout">{!atEnd && !composerPinned && <CommentComposer slug={slug} compact expanded={compactExpanded} onExpandedChange={setCompactExpanded} />}</AnimatePresence>
    </aside>
    <div className={styles.articleReadingMain}>{children}</div>
    {toc.length > 0 && <ArticleToc items={toc} />}
    <section className={styles.articleDiscussionBlock} aria-label="Article discussion">
      {discussion}
      <div ref={discussionEndRef} className={styles.articleComposerTrigger} aria-hidden="true" />
    </section>
    <section className={styles.articleComposerBlock} data-active={showBottomComposer ? "true" : "false"} aria-label="Add a comment" aria-hidden={!showBottomComposer}>
      <AnimatePresence initial={false} mode="popLayout">{showBottomComposer && <CommentComposer slug={slug} expanded={bottomExpanded} anchorId="comment-composer" onExpandedChange={setBottomExpanded} onPhaseChange={setBottomComposerPhase} />}</AnimatePresence>
    </section>
  </div></ReplyContext.Provider></LayoutGroup>;
}
