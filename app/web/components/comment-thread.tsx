"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Filter, MessageCircle, Reply, Search, Send, Share2, UserRound, X } from "lucide-react";
import { FaGithub } from "react-icons/fa";
import { Button } from "@radix-ui/themes";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { Comment } from "@manifold/contracts";
import { createAnonymousBrowserClient, createBrowserClient, getVisitorId } from "../lib/api";
import { filterComments, type CommentFilter } from "../lib/comment-filter";
import { getIdentity, saveIdentity, type CommentIdentity } from "../lib/identity";
import { formatRelativeTime } from "../lib/relative-time";
import styles from "../app/site.module.css";
import { AvatarPicker, CommentAvatar } from "./comment-avatar";
import { FloatingTooltip } from "./floating-tooltip";
import { CommentMarkdown } from "@manifold/render";
import { LikeButton } from "./like-button";
import { Pagination } from "./pagination";

const makeCommentSchema = (captchaAnswer: string, authed: boolean) => z.object({
  authorName: z.string().trim().max(80).optional(),
  authorUrl: z.string().trim().url("Use a complete URL.").or(z.literal("")).optional(),
  body: z.string().trim().min(3, "A little more detail would help.").max(4000),
  captcha: authed ? z.string().optional() : z.string().min(1, "Solve the small check."),
}).superRefine((value, context) => {
  if (value.captcha && value.captcha !== captchaAnswer) context.addIssue({ code: "custom", path: ["captcha"], message: "Solve the small check." });
});
type CommentForm = z.infer<ReturnType<typeof makeCommentSchema>>;

type CaptchaChallenge = { prompt: string; answer: string };
function makeCaptcha(): CaptchaChallenge {
  const a = 1 + Math.floor(Math.random() * 9);
  const b = 1 + Math.floor(Math.random() * 9);
  return { prompt: `What is ${a} + ${b}?`, answer: String(a + b) };
}

const OPEN_COMPOSER_EVENT = "manifold:open-composer";

const MAX_INDENT = 2;
const COMMENT_PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;
const MIN_SUBMIT_VEIL_MS = 350;
const POSTED_COMMENT_SCROLL_TRIES = 8;
const POSTED_COMMENT_SCROLL_INTERVAL_MS = 350;

type CommentNode = { comment: Comment; children: CommentNode[] };

function buildThreads(comments: Comment[]) {
  const nodes = new Map<string, CommentNode>();
  const roots: CommentNode[] = [];
  for (const comment of comments) nodes.set(comment.id, { comment, children: [] });
  for (const node of nodes.values()) {
    const parent = node.comment.replyToId ? nodes.get(node.comment.replyToId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export type ComposerPhase = "editing" | "submitting" | "success";

export type ReplyContextValue = { replyTarget: Comment | null; startReply: (comment: Comment) => void; cancelReply: () => void };

export const ReplyContext = createContext<ReplyContextValue | null>(null);

function useReply() {
  const value = useContext(ReplyContext);
  if (!value) throw new Error("Reply components require a ReplyContext provider");
  return value;
}

export type CommentsPagingController = { revealPosted: (comment: Comment) => void };

export const CommentsPagingRefContext = createContext<RefObject<CommentsPagingController>>({ current: { revealPosted: () => {} } });

export function useReplyFocus(replyTarget: Comment | null) {
  useEffect(() => {
    if (!replyTarget) return;
    let cancelled = false;
    const timers: number[] = [];
    const schedule = (fn: () => void, delay: number) => timers.push(window.setTimeout(fn, delay));
    const attempt = (tries: number) => {
      if (cancelled) return;
      const composer = document.getElementById("comment-composer");
      if (composer) {
        (composer.parentElement ?? composer).scrollIntoView({ behavior: "smooth", block: "center" });
        schedule(() => document.getElementById("comment-body")?.focus({ preventScroll: true }), 500);
        if (tries > 0) schedule(() => attempt(tries - 1), 320);
        return;
      }
      if (tries > 0) schedule(() => attempt(tries - 1), 120);
    };
    schedule(() => attempt(4), 60);
    return () => {
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [replyTarget]);
}

function CommentItem({ node, depth = 0 }: { node: CommentNode; depth?: number }) {
  const { startReply } = useReply();
  const { comment, children } = node;
  return <motion.article id={comment.id} className={styles.commentThreadItem} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
    {comment.hidden
      ? <div className={styles.commentRow}>
          <div className={styles.commentBubbleWrap}>
            <div className={`${styles.commentBubble} ${styles.commentHiddenBubble}`}>
              <p>This comment was hidden by moderation.</p>
            </div>
          </div>
        </div>
      : <div className={styles.commentRow}>
          {comment.authorAvatarUrl
            // GitHub avatar URLs are provider-signed and outside next/image's
            // remote patterns; referrerPolicy keeps them private.
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={comment.authorAvatarUrl} alt="" className={styles.commentAvatarImage} referrerPolicy="no-referrer" loading="lazy" />
            : <CommentAvatar seed={comment.avatarSeed || comment.id} />}
          <div className={styles.commentBubbleWrap}>
            <div className={styles.commentMetaRow}>
              <strong>{comment.authorName}</strong>
              {comment.authorProvider === "github" && <span className={styles.commentProvider}>via GitHub</span>}
              <time className={styles.commentTime} dateTime={comment.createdAt}>{formatRelativeTime(comment.createdAt)}</time>
            </div>
            <div className={styles.commentBubble}>
              <CommentMarkdown content={comment.body} />
              <button type="button" className={styles.commentReplyButton} onClick={() => startReply(comment)}><Reply size={12} /> Reply</button>
            </div>
          </div>
        </div>}
    {children.length > 0 && <div className={depth < MAX_INDENT ? styles.commentNest : styles.commentThreadList}>
      {children.map((child) => <CommentItem key={child.comment.id} node={child} depth={depth + 1} />)}
    </div>}
  </motion.article>;
}

function CommentList({ comments }: { comments: Comment[] }) {
  const roots = useMemo(() => buildThreads(comments), [comments]);
  return <div className={styles.commentThreadList}>
    <AnimatePresence initial={false}>
      {roots.map((node) => <CommentItem key={node.comment.id} node={node} />)}
    </AnimatePresence>
  </div>;
}

type ArticleDiscussionProps = { slug: string; viewCount?: number; likeCount?: number; showStats?: boolean; commentsEnabled?: boolean };

export function ArticleDiscussion({ slug, viewCount = 0, likeCount = 0, showStats = true, commentsEnabled = true }: ArticleDiscussionProps) {
  const client = useMemo(() => createBrowserClient(), []);
  const pagingRef = useContext(CommentsPagingRefContext);
  const sectionRef = useRef<HTMLElement>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<CommentFilter>("all");
  const [visitorId] = useState(() => typeof window === "undefined" ? "" : getVisitorId());
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);
  const commentsQuery = useQuery({
    queryKey: ["comments", slug, page, debouncedSearch],
    queryFn: () => client.comments(slug, { page, pageSize: COMMENT_PAGE_SIZE, q: debouncedSearch || undefined }),
    placeholderData: keepPreviousData,
    enabled: commentsEnabled,
  });
  const likesQuery = useQuery({ queryKey: ["likes", slug, visitorId], queryFn: () => client.likes(slug, visitorId), enabled: Boolean(visitorId) });
  const comments = useMemo(() => commentsQuery.data?.data ?? [], [commentsQuery.data]);
  const pagination = commentsQuery.data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;
  const displayPage = pagination?.page ?? page;
  const totalComments = pagination?.totalItems ?? comments.length;
  const visibleComments = useMemo(() => filterComments(comments, "", filter), [comments, filter]);
  const currentLikeCount = likesQuery.data?.likeCount ?? likeCount;
  useEffect(() => {
    pagingRef.current.revealPosted = (comment: Comment) => {
      if (comment.replyToId) return;
      setSearch("");
      setDebouncedSearch("");
      setPage(totalPages);
    };
  });
  const changePage = (next: number) => {
    setPage(Math.min(Math.max(1, next), totalPages));
    window.requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const onSearchInput = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  if (!commentsEnabled) return null;
  return <section id="comments" ref={sectionRef} className={styles.commentSection} aria-labelledby="comments-title">
    <div className={styles.sectionHeading}>
      <div><span className={styles.eyebrow}>Discussion</span><h2 id="comments-title">The thread</h2></div>
      <span className={styles.commentCount}>{totalComments}</span>
    </div>
    {showStats && <div className={styles.commentStats} aria-label="Article discussion statistics">
      <span><strong>{viewCount}</strong> views</span>
      <span><strong>{currentLikeCount}</strong> likes</span>
      <span><strong>{totalComments}</strong> comments</span>
    </div>}
    <div className={styles.commentTools}>
      <label className={styles.commentSearch}><Search size={15} aria-hidden="true" /><span className={styles.srOnly}>Search comments</span><input value={search} onChange={(event) => onSearchInput(event.target.value)} placeholder="Search comments" /></label>
      <label className={styles.commentFilter}><Filter size={15} aria-hidden="true" /><span className={styles.srOnly}>Filter comments</span><select value={filter} onChange={(event) => setFilter(event.target.value as CommentFilter)}><option value="all">All comments</option><option value="withWebsite">With website</option><option value="recent">Recent</option></select></label>
    </div>
    {commentsQuery.isLoading && <p className={styles.muted}>Loading responses...</p>}
    {commentsQuery.isError && <p className={styles.errorText}>Responses are unavailable at the moment.</p>}
    {!commentsQuery.isLoading && !commentsQuery.isError && totalComments === 0 && (debouncedSearch
      ? <p className={styles.muted}>No comments match this search.</p>
      : <p className={styles.commentEmpty}><span>No responses yet.</span><button type="button" className={styles.commentEmptyCTA} onClick={() => window.dispatchEvent(new CustomEvent(OPEN_COMPOSER_EVENT))}><MessageCircle size={15} /> Start the thread</button></p>)}
    {!commentsQuery.isLoading && !commentsQuery.isError && comments.length > 0 && visibleComments.length === 0 && <p className={styles.muted}>No comments match this filter on this page.</p>}
    <CommentList comments={visibleComments} />
    {totalPages > 1 && <Pagination page={displayPage} totalPages={totalPages} onChange={changePage} disabled={commentsQuery.isPending || commentsQuery.isPlaceholderData} label="Comment pages" />}
  </section>;
}

function shareArticle() {
  if (typeof window === "undefined") return;
  if (navigator.share) {
    void navigator.share({ title: document.title, url: window.location.href }).catch(() => undefined);
  } else if (navigator.clipboard) {
    void navigator.clipboard.writeText(window.location.href);
  }
}

type CommentComposerProps = { slug: string; expanded: boolean; compact?: boolean; anchorId?: string; onExpandedChange?: (expanded: boolean) => void; onPhaseChange?: (phase: ComposerPhase) => void };

export function CommentComposer({ slug, expanded, compact = false, anchorId, onExpandedChange, onPhaseChange }: CommentComposerProps) {
  const client = useMemo(() => createBrowserClient(), []);
  const guestClient = useMemo(() => createAnonymousBrowserClient(), []);
  const queryClient = useQueryClient();
  const { replyTarget, cancelReply } = useReply();
  const pagingRef = useContext(CommentsPagingRefContext);
  const [visitorId] = useState(() => typeof window === "undefined" ? "" : getVisitorId());
  const [identity, setIdentity] = useState<CommentIdentity>({ name: "", avatarSeed: "" });
  const [postedCommentId, setPostedCommentId] = useState<string | null>(null);
  const [postedMissing, setPostedMissing] = useState(false);
  const [composerPhase, setComposerPhase] = useState<ComposerPhase>("editing");
  const [localExpanded, setLocalExpanded] = useState(expanded);
  // null means "not picked yet": derive from the session so a signed-in visitor
  // starts on GitHub while an anonymous one starts as a guest. Picking an icon
  // pins the mode until the next explicit choice, which is what lets a GitHub
  // session post as a guest (and back) without losing the sign-in.
  const [authMode, setAuthMode] = useState<"github" | "guest" | null>(null);
  const [githubTip, setGithubTip] = useState(false);
  const [guestTip, setGuestTip] = useState(false);
  const githubAnchorRef = useRef<HTMLButtonElement>(null);
  const guestAnchorRef = useRef<HTMLButtonElement>(null);
  const [captcha, setCaptcha] = useState<CaptchaChallenge | null>(null);
  const isExpanded = onExpandedChange ? expanded : localExpanded;
  const authQuery = useQuery({ queryKey: ["auth", "me"], queryFn: () => client.authMe(), retry: 1, staleTime: 5 * 60 * 1000 });
  const isAuthed = authQuery.data?.authenticated === true;
  const authedName = authQuery.data?.displayName ?? "";
  const authedAvatar = authQuery.data?.avatarUrl ?? "";
  const githubAvailable = authQuery.data?.providers?.includes("github") ?? false;
  const effectiveAuthMode = authMode ?? (isAuthed ? "github" : "guest");
  const showGitHubIdentity = effectiveAuthMode === "github" && isAuthed;
  const showForm = isExpanded && (effectiveAuthMode === "guest" || isAuthed);
  const commentSchema = useMemo(() => makeCommentSchema(captcha?.answer ?? "", showGitHubIdentity), [captcha, showGitHubIdentity]);
  const form = useForm<CommentForm>({ resolver: zodResolver(commentSchema), defaultValues: { authorName: "", authorUrl: "", body: "", captcha: "" } });
  useEffect(() => {
    // The challenge must be generated client-side only: a random prompt in the
    // initializer would differ between the SSR HTML and the hydration render.
    // setTimeout keeps generating even while the tab is backgrounded (rAF pauses).
    const timer = window.setTimeout(() => setCaptcha(makeCaptcha()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const openComposer = () => {
      if (onExpandedChange) onExpandedChange(true);
      else setLocalExpanded(true);
      const el = document.getElementById("comment-composer");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        window.setTimeout(() => document.getElementById("comment-body")?.focus({ preventScroll: true }), 420);
      }
    };
    window.addEventListener(OPEN_COMPOSER_EVENT, openComposer);
    return () => window.removeEventListener(OPEN_COMPOSER_EVENT, openComposer);
  }, [onExpandedChange]);
  const successTimerRef = useRef<number | null>(null);
  const viewTimersRef = useRef<number[]>([]);
  const authListenerRef = useRef<((event: MessageEvent) => void) | null>(null);
  const updatePhase = useCallback((phase: ComposerPhase) => {
    setComposerPhase(phase);
    onPhaseChange?.(phase);
  }, [onPhaseChange]);
  useEffect(() => {
    if (!visitorId) return;
    const frame = window.requestAnimationFrame(() => {
      const stored = getIdentity(visitorId);
      setIdentity(stored);
      if (!form.getValues("authorName")) form.setValue("authorName", stored.name, { shouldDirty: false });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [visitorId, form]);
  useEffect(() => {
    if (!replyTarget) return;
    const frame = window.requestAnimationFrame(() => updatePhase("editing"));
    return () => window.cancelAnimationFrame(frame);
  }, [replyTarget, updatePhase]);
  useEffect(() => () => {
    if (successTimerRef.current !== null) window.clearTimeout(successTimerRef.current);
    for (const timer of viewTimersRef.current) window.clearTimeout(timer);
    if (authListenerRef.current) window.removeEventListener("message", authListenerRef.current);
  }, []);
  const mutation = useMutation({
    mutationFn: (input: CommentForm) => showGitHubIdentity
      ? client.createComment(slug, { authorUrl: input.authorUrl || undefined, body: input.body, replyToId: replyTarget?.id })
      : guestClient.createComment(slug, { authorName: input.authorName || undefined, authorUrl: input.authorUrl || undefined, body: input.body, replyToId: replyTarget?.id, avatarSeed: identity.avatarSeed || undefined }),
    onSuccess: (comment, input) => {
      if (!showGitHubIdentity) saveIdentity({ name: input.authorName || identity.name, avatarSeed: identity.avatarSeed }, visitorId);
      void queryClient.invalidateQueries({ queryKey: ["comments", slug] });
      const finalize = () => {
        cancelReply();
        form.reset({ authorName: input.authorName || identity.name, authorUrl: "", body: "", captcha: "" });
        setCaptcha(makeCaptcha());
        setPostedCommentId(comment.id);
        setPostedMissing(false);
        pagingRef.current.revealPosted(comment);
        updatePhase("success");
      };
      successTimerRef.current = window.setTimeout(finalize, MIN_SUBMIT_VEIL_MS);
    },
    onError: () => {
      if (successTimerRef.current !== null) {
        window.clearTimeout(successTimerRef.current);
        successTimerRef.current = null;
      }
      updatePhase("editing");
    },
  });
  const submitComment = form.handleSubmit((input) => {
    updatePhase("submitting");
    mutation.mutate(input);
  });
  const commentAgain = () => {
    mutation.reset();
    setPostedCommentId(null);
    setPostedMissing(false);
    setCaptcha(makeCaptcha());
    updatePhase("editing");
    window.setTimeout(() => document.getElementById("comment-body")?.focus({ preventScroll: true }), 420);
  };
  const viewPostedComment = () => {
    if (!postedCommentId) return;
    setPostedMissing(false);
    for (const timer of viewTimersRef.current) window.clearTimeout(timer);
    viewTimersRef.current = [];
    const attempt = (tries: number) => {
      const bubble = document.getElementById(postedCommentId);
      if (bubble) {
        bubble.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      if (tries <= 0) {
        setPostedMissing(true);
        return;
      }
      viewTimersRef.current.push(window.setTimeout(() => attempt(tries - 1), POSTED_COMMENT_SCROLL_INTERVAL_MS));
    };
    attempt(POSTED_COMMENT_SCROLL_TRIES);
  };
  const toggleExpanded = () => onExpandedChange ? onExpandedChange(!expanded) : setLocalExpanded((value) => !value);
  const expandComposer = () => onExpandedChange ? onExpandedChange(true) : setLocalExpanded(true);
  const startGitHub = () => {
    if (isAuthed) {
      setAuthMode("github");
      expandComposer();
      return;
    }
    const returnTo = `${window.location.pathname}${window.location.search}`;
    const authUrl = `/api/v1/auth/github/login?return_to=${encodeURIComponent(returnTo)}`;
    // OAuth runs in a popup so the current page never navigates away and the
    // history stack stays untouched (the back button can't land on GitHub).
    // The callback notifies this window via postMessage, then closes itself.
    const popup = window.open(authUrl, "manifold-github-oauth", "width=680,height=820,popup=yes");
    if (!popup) {
      // Popup blocked: fall back to a full-page leg; the callback's
      // location.replace keeps the history stack clean.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = authUrl;
      return;
    }
    if (authListenerRef.current) window.removeEventListener("message", authListenerRef.current);
    const onAuthMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "manifold:github-auth") return;
      window.removeEventListener("message", onAuthMessage);
      authListenerRef.current = null;
      popup.close();
      if (event.data.ok === true) {
        setAuthMode("github");
        expandComposer();
        // The popup leg already wrote the visitor cookie; drop the stale
        // session so the GitHub identity form renders.
        void queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      }
    };
    authListenerRef.current = onAuthMessage;
    window.addEventListener("message", onAuthMessage);
  };
  const selectGuest = () => {
    setAuthMode("guest");
    expandComposer();
  };
  const chooseAvatar = (avatarSeed: string) => {
    setIdentity((current) => ({ ...current, avatarSeed }));
    saveIdentity({ avatarSeed }, visitorId);
  };

  // Height animation is deliberately avoided: animating the container height in
  // the document flow makes the scrollbar grow/shrink on every frame. The card
  // and form snap to their target height once while the content fades, so the
  // page height changes exactly twice per toggle instead of flickering. The
  // compact rail slides down and fades when it hands over to the bottom
  // composer, keeping the "slide down" feel without a cross-position layoutId.
  return <motion.div layoutId={compact ? "article-composer-compact" : "article-composer-bottom"} id={anchorId} className={styles.articleComposerCard} data-compact={compact ? "true" : "false"} data-expanded={isExpanded ? "true" : "false"} data-replying={replyTarget ? "true" : "false"} data-phase={composerPhase} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={compact ? { opacity: 0, y: 24 } : { opacity: 0 }} transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }} style={{ overflowAnchor: "none" }}>
    <div className={styles.articleComposerActions}>
      <span className={styles.articleActionLabel}>{compact ? "Leave a trace" : "Add a comment"}</span>
      <span className={styles.commentAuthButtons}>
        {githubAvailable && <button ref={githubAnchorRef} type="button" className={`${styles.commentAuthButton} ${effectiveAuthMode === "github" ? styles.commentAuthButtonActive : ""}`} aria-label="GitHub" aria-pressed={effectiveAuthMode === "github"} onClick={startGitHub} onMouseEnter={() => setGithubTip(true)} onMouseLeave={() => setGithubTip(false)} onFocus={() => setGithubTip(true)} onBlur={() => setGithubTip(false)}><FaGithub size={15} aria-hidden="true" /></button>}
        <button ref={guestAnchorRef} type="button" className={`${styles.commentAuthButton} ${effectiveAuthMode === "guest" ? styles.commentAuthButtonActive : ""}`} aria-label="Guest" aria-pressed={effectiveAuthMode === "guest"} onClick={selectGuest} onMouseEnter={() => setGuestTip(true)} onMouseLeave={() => setGuestTip(false)} onFocus={() => setGuestTip(true)} onBlur={() => setGuestTip(false)}><UserRound size={15} aria-hidden="true" /></button>
      </span>
      <FloatingTooltip anchorRef={githubAnchorRef} open={githubTip} placement={compact ? "right" : "top"} dataAttribute="data-auth-tooltip">
        <span className={styles.tooltipMeta}>GitHub</span>
        <span>{showGitHubIdentity ? `Signed in as ${authedName}` : "Sign in with GitHub"}</span>
      </FloatingTooltip>
      <FloatingTooltip anchorRef={guestAnchorRef} open={guestTip} placement={compact ? "right" : "top"} dataAttribute="data-auth-tooltip">
        <span className={styles.tooltipMeta}>Guest</span>
        <span>{effectiveAuthMode === "guest" ? "Commenting as guest" : "Comment as guest"}</span>
      </FloatingTooltip>
      <LikeButton slug={slug} compact={compact} />
      <button type="button" className={styles.articleActionButton} aria-expanded={isExpanded} onClick={toggleExpanded}><MessageCircle size={15} /> <span>{isExpanded ? "Hide comment" : "Comment"}</span></button>
      <button type="button" className={styles.articleActionButton} onClick={shareArticle}><Share2 size={15} /> <span>Share</span></button>
    </div>
    <AnimatePresence initial={false}>
      {showForm && <motion.form className={styles.commentForm} onSubmit={submitComment} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }} style={{ overflowAnchor: "none" }}>
        <div className={styles.commentFormBody}>
          {replyTarget && <div className={styles.replyBanner} role="note">
            <div className={styles.replyBannerBody}>
              <span>Replying to <strong>{replyTarget.authorName || "Anonymous"}</strong></span>
              <p>{replyTarget.body}</p>
            </div>
            <button type="button" className={styles.replyBannerCancel} onClick={cancelReply} aria-label="Cancel reply"><X size={14} /></button>
          </div>}
          {showGitHubIdentity
            ? <div className={styles.commentIdentity}>
                {authedAvatar
                  // GitHub avatar URL, provider-signed; see the comment row note.
                  // eslint-disable-next-line @next/next/no-img-element
                  && <img src={authedAvatar} alt="" className={styles.accountAvatar} referrerPolicy="no-referrer" />}
                <div className={styles.accountInfo}>
                  <strong>{authedName}</strong>
                  <span className={styles.accountProvider}>via GitHub</span>
                </div>
                <label>Website <span>(optional)</span><input {...form.register("authorUrl")} placeholder="https://" inputMode="url" autoComplete="url" />{form.formState.errors.authorUrl && <small>{form.formState.errors.authorUrl.message}</small>}</label>
              </div>
            : <div className={styles.commentIdentity}>
                <AvatarPicker seed={identity.avatarSeed || "manifold"} onChange={chooseAvatar} />
                <label>Name <span>(optional)</span><input {...form.register("authorName")} placeholder="Anonymous" autoComplete="name" />{form.formState.errors.authorName && <small>{form.formState.errors.authorName.message}</small>}</label>
                <label>Website <span>(optional)</span><input {...form.register("authorUrl")} placeholder="https://" inputMode="url" autoComplete="url" />{form.formState.errors.authorUrl && <small>{form.formState.errors.authorUrl.message}</small>}</label>
              </div>}
          <label>Comment<textarea {...form.register("body")} id="comment-body" placeholder="Write a comment" rows={5} />{form.formState.errors.body && <small>{form.formState.errors.body.message}</small>}</label>
          {showGitHubIdentity
            ? <div className={styles.commentSubmitRow}>
                <span className={styles.accountSignedIn}>Signed in as <strong>{authedName}</strong></span>
                <Button className={styles.primaryButton} type="submit" disabled={mutation.isPending}><Send size={15} /> Post comment</Button>
              </div>
            : <div className={styles.commentSubmitRow}>
                <label>Quick check <span>({captcha ? captcha.prompt : "small check"})</span><input {...form.register("captcha")} inputMode="numeric" placeholder="Answer" autoComplete="off" />{form.formState.errors.captcha && <small>{form.formState.errors.captcha.message}</small>}</label>
                <Button className={styles.primaryButton} type="submit" disabled={mutation.isPending}><Send size={15} /> Post comment</Button>
              </div>}
          {mutation.isError && <p className={styles.errorText}>Could not send the comment. Please try again.</p>}
        </div>
        <AnimatePresence>
          {composerPhase === "submitting" && <motion.div key="veil" className={styles.commentVeil} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }} role="status" aria-live="polite">
            <span className={styles.commentSpinner} aria-hidden="true" />
            <span className={styles.srOnly}>Posting your comment…</span>
          </motion.div>}
          {composerPhase === "success" && <motion.div key="success" className={styles.commentSuccess} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }} role="status">
            <motion.svg className={styles.commentSuccessCheck} viewBox="0 0 24 24" aria-hidden="true">
              <motion.circle cx="12" cy="12" r="10.4" pathLength={1} initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} />
              <motion.path d="M7.4 12.6l3.1 3.1 6.1-6.6" pathLength={1} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.3, duration: 0.38, ease: [0.16, 1, 0.3, 1] }} />
            </motion.svg>
            <p>Your comment has been posted.</p>
            <div className={styles.commentSuccessActions}>
              <button type="button" className={styles.primaryButton} onClick={viewPostedComment}>View your comment</button>
              <button type="button" className={styles.commentGhostButton} onClick={commentAgain}>Comment again</button>
            </div>
            {postedMissing && <p className={styles.commentSuccessHint}>If it does not appear, refresh the page.</p>}
          </motion.div>}
        </AnimatePresence>
      </motion.form>}
    </AnimatePresence>
  </motion.div>;
}

export function CommentsSection({ slug, viewCount, likeCount, commentsEnabled = true }: { slug: string; viewCount: number; likeCount: number; commentsEnabled?: boolean }) {
  const [replyTarget, setReplyTarget] = useState<Comment | null>(null);
  useReplyFocus(replyTarget);
  const reply = useMemo<ReplyContextValue>(() => ({ replyTarget, startReply: setReplyTarget, cancelReply: () => setReplyTarget(null) }), [replyTarget]);
  const commentsPagingRef = useRef<CommentsPagingController>({ revealPosted: () => {} });
  if (!commentsEnabled) return null;
  return <CommentsPagingRefContext.Provider value={commentsPagingRef}>
    <ReplyContext.Provider value={reply}>
      <section className="articleDiscussionBlock" aria-label="Thought discussion">
        <ArticleDiscussion slug={slug} viewCount={viewCount} likeCount={likeCount} />
      </section>
      <section className="articleComposerBlock" data-active="true" aria-label="Add a comment">
        <CommentComposer slug={slug} expanded anchorId="comment-composer" />
      </section>
    </ReplyContext.Provider>
  </CommentsPagingRefContext.Provider>;
}
