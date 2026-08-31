"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup } from "framer-motion";
import type { Comment } from "@manifold/contracts";
import { ReadingShell, type RenderTocItem } from "@manifold/render";
import { resolveArticleActionsAtEnd } from "../lib/article-end-threshold";
import { CommentComposer, CommentsPagingRefContext, ReplyContext, useReplyFocus, type CommentsPagingController, type ComposerPhase, type ReplyContextValue } from "./comment-thread";

const ARTICLE_END_ACTIVATION_RATIO = 0.76;

export function ArticleReadingShell({ children, discussion, toc, slug }: { children: React.ReactNode; discussion: React.ReactNode; toc: RenderTocItem[]; slug: string }) {
  const discussionEndRef = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(false);
  const [compactExpanded, setCompactExpanded] = useState(false);
  const [bottomExpanded, setBottomExpanded] = useState(true);
  const [replyTarget, setReplyTarget] = useState<Comment | null>(null);
  const [bottomComposerPhase, setBottomComposerPhase] = useState<ComposerPhase>("editing");
  const [railPhase, setRailPhase] = useState<ComposerPhase>("editing");
  const composerPinned = replyTarget !== null || bottomComposerPhase !== "editing";
  // A composer that is submitting or showing its success veil must not be
  // swapped out mid-animation, even when the scroll position says the rail
  // should hand over to the bottom composer.
  const railVisible = !composerPinned && (!atEnd || railPhase !== "editing");
  const showBottomComposer = (atEnd || composerPinned) && !(railVisible && railPhase !== "editing");
  useReplyFocus(replyTarget);
  const reply = useMemo<ReplyContextValue>(() => ({ replyTarget, startReply: (comment) => { setRailPhase("editing"); setReplyTarget(comment) }, cancelReply: () => setReplyTarget(null) }), [replyTarget]);
  const commentsPagingRef = useRef<CommentsPagingController>({ revealPosted: () => {} });
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

  return <CommentsPagingRefContext.Provider value={commentsPagingRef}><LayoutGroup id="article-reading-actions"><ReplyContext.Provider value={reply}>
    <ReadingShell
      toc={toc}
      rail={<aside className="articleActionRail" aria-label="Article actions"><AnimatePresence initial={false} mode="popLayout">{railVisible && <CommentComposer slug={slug} compact expanded={compactExpanded} onExpandedChange={setCompactExpanded} onPhaseChange={setRailPhase} />}</AnimatePresence></aside>}
      discussion={discussion}
      discussionTrigger={<div ref={discussionEndRef} className="articleComposerTrigger" aria-hidden="true" />}
      composer={<section className="articleComposerBlock" data-active={showBottomComposer ? "true" : "false"} aria-label="Add a comment" aria-hidden={!showBottomComposer}><AnimatePresence initial={false} mode="popLayout">{showBottomComposer && <CommentComposer slug={slug} expanded={bottomExpanded} anchorId="comment-composer" onExpandedChange={setBottomExpanded} onPhaseChange={setBottomComposerPhase} />}</AnimatePresence></section>}
    >
      {children}
    </ReadingShell>
  </ReplyContext.Provider></LayoutGroup></CommentsPagingRefContext.Provider>;
}
