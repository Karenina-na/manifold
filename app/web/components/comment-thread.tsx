"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, Filter, Heart, MessageCircle, Reply, Search, Send, Share2, X } from "lucide-react";
import { Button, TextArea, TextField } from "@radix-ui/themes";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { Comment } from "@manifold/contracts";
import { createBrowserClient, getVisitorId } from "../lib/api";
import { filterComments, type CommentFilter } from "../lib/comment-filter";
import { getIdentity, saveIdentity, type CommentIdentity } from "../lib/identity";
import { formatRelativeTime } from "../lib/relative-time";
import styles from "../app/site.module.css";
import { AvatarPicker, CommentAvatar } from "./comment-avatar";
import { LikeButton } from "./like-button";

const commentSchema = z.object({
  authorName: z.string().trim().max(80),
  authorUrl: z.string().trim().url("Use a complete URL.").or(z.literal("")),
  body: z.string().trim().min(3, "A little more detail would help.").max(4000),
  captcha: z.string().min(1, "Solve the small check."),
}).superRefine((value, context) => { if (value.captcha !== "7") context.addIssue({ code: "custom", path: ["captcha"], message: "Solve the small check." }); });
type CommentForm = z.infer<typeof commentSchema>;

const MAX_INDENT = 2;

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

export type ReplyContextValue = { replyTarget: Comment | null; startReply: (comment: Comment) => void; cancelReply: () => void };

export const ReplyContext = createContext<ReplyContextValue | null>(null);

function useReply() {
  const value = useContext(ReplyContext);
  if (!value) throw new Error("Reply components require a ReplyContext provider");
  return value;
}

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
  return <motion.article className={styles.commentThreadItem} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
    <div className={styles.commentRow}>
      <CommentAvatar seed={comment.avatarSeed || comment.id} />
      <div className={styles.commentBubbleWrap}>
        <div className={styles.commentMetaRow}>
          <strong>{comment.authorName}</strong>
          <time className={styles.commentTime} dateTime={comment.createdAt}>{formatRelativeTime(comment.createdAt)}</time>
        </div>
        <div className={styles.commentBubble}>
          <p>{comment.body}</p>
          <button type="button" className={styles.commentReplyButton} onClick={() => startReply(comment)}><Reply size={12} /> Reply</button>
        </div>
      </div>
    </div>
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

type ArticleDiscussionProps = { slug: string; viewCount?: number; likeCount?: number; showStats?: boolean };

export function ArticleDiscussion({ slug, viewCount = 0, likeCount = 0, showStats = true }: ArticleDiscussionProps) {
  const client = useMemo(() => createBrowserClient(), []);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CommentFilter>("all");
  const [visitorId] = useState(() => typeof window === "undefined" ? "" : getVisitorId());
  const commentsQuery = useQuery({ queryKey: ["comments", slug], queryFn: () => client.comments(slug) });
  const likesQuery = useQuery({ queryKey: ["likes", slug, visitorId], queryFn: () => client.likes(slug, visitorId), enabled: Boolean(visitorId) });
  const comments = useMemo(() => commentsQuery.data?.data ?? [], [commentsQuery.data]);
  const visibleComments = useMemo(() => filterComments(comments, search, filter), [comments, search, filter]);
  const currentLikeCount = likesQuery.data?.likeCount ?? likeCount;

  return <section id="comments" className={`${styles.commentSection} ${styles.articleDiscussion}`} aria-labelledby="comments-title">
    <div className={styles.sectionHeading}>
      <div><span className={styles.eyebrow}>Discussion</span><h2 id="comments-title">The thread</h2></div>
      <span className={styles.commentCount}>{comments.length}</span>
    </div>
    {showStats && <div className={styles.commentStats} aria-label="Article discussion statistics">
      <span><Eye size={15} aria-hidden="true" /> <strong>{viewCount}</strong> views</span>
      <span><Heart size={15} aria-hidden="true" /> <strong>{currentLikeCount}</strong> likes</span>
      <span><MessageCircle size={15} aria-hidden="true" /> <strong>{comments.length}</strong> comments</span>
    </div>}
    <div className={styles.commentTools}>
      <label className={styles.commentSearch}><Search size={15} aria-hidden="true" /><span className={styles.srOnly}>Search comments</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search comments" /></label>
      <label className={styles.commentFilter}><Filter size={15} aria-hidden="true" /><span className={styles.srOnly}>Filter comments</span><select value={filter} onChange={(event) => setFilter(event.target.value as CommentFilter)}><option value="all">All comments</option><option value="withWebsite">With website</option><option value="recent">Recent</option></select></label>
    </div>
    {commentsQuery.isLoading && <p className={styles.muted}>Loading responses...</p>}
    {commentsQuery.isError && <p className={styles.errorText}>Responses are unavailable at the moment.</p>}
    {!commentsQuery.isLoading && !commentsQuery.isError && comments.length === 0 && <p className={styles.muted}>No responses yet. Start the thread.</p>}
    {!commentsQuery.isLoading && !commentsQuery.isError && comments.length > 0 && visibleComments.length === 0 && <p className={styles.muted}>No comments match this search.</p>}
    <CommentList comments={visibleComments} />
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

type CommentComposerProps = { slug: string; expanded: boolean; compact?: boolean; anchorId?: string; onExpandedChange?: (expanded: boolean) => void };

export function CommentComposer({ slug, expanded, compact = false, anchorId, onExpandedChange }: CommentComposerProps) {
  const client = useMemo(() => createBrowserClient(), []);
  const queryClient = useQueryClient();
  const { replyTarget, cancelReply } = useReply();
  const [visitorId] = useState(() => typeof window === "undefined" ? "" : getVisitorId());
  const [identity, setIdentity] = useState<CommentIdentity>({ name: "", avatarSeed: "" });
  const [localExpanded, setLocalExpanded] = useState(expanded);
  const isExpanded = onExpandedChange ? expanded : localExpanded;
  const form = useForm<CommentForm>({ resolver: zodResolver(commentSchema), defaultValues: { authorName: "", authorUrl: "", body: "", captcha: "" } });
  useEffect(() => {
    if (!visitorId) return;
    const frame = window.requestAnimationFrame(() => {
      const stored = getIdentity(visitorId);
      setIdentity(stored);
      if (!form.getValues("authorName")) form.setValue("authorName", stored.name, { shouldDirty: false });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [visitorId, form]);
  const mutation = useMutation({
    mutationFn: (input: CommentForm) => client.createComment(slug, { authorName: input.authorName, authorUrl: input.authorUrl || undefined, body: input.body, replyToId: replyTarget?.id, avatarSeed: identity.avatarSeed || undefined }),
    onSuccess: (_result, input) => {
      saveIdentity({ name: input.authorName || identity.name, avatarSeed: identity.avatarSeed }, visitorId);
      cancelReply();
      form.reset({ authorName: input.authorName || identity.name, authorUrl: "", body: "", captcha: "" });
      void queryClient.invalidateQueries({ queryKey: ["comments", slug] });
    },
  });
  const toggleExpanded = () => onExpandedChange ? onExpandedChange(!expanded) : setLocalExpanded((value) => !value);
  const chooseAvatar = (avatarSeed: string) => {
    setIdentity((current) => ({ ...current, avatarSeed }));
    saveIdentity({ avatarSeed }, visitorId);
  };

  return <motion.div layoutId="article-composer" id={anchorId} className={styles.articleComposerCard} data-compact={compact ? "true" : "false"} data-expanded={isExpanded ? "true" : "false"} data-replying={replyTarget ? "true" : "false"}>
    <div className={styles.articleComposerActions}>
      <span className={styles.articleActionLabel}>{compact ? "Leave a trace" : "Add a comment"}</span>
      <LikeButton slug={slug} compact={compact} />
      <button type="button" className={styles.articleActionButton} aria-expanded={isExpanded} onClick={toggleExpanded}><MessageCircle size={15} /> <span>{isExpanded ? "Hide comment" : "Comment"}</span></button>
      <button type="button" className={styles.articleActionButton} onClick={shareArticle}><Share2 size={15} /> <span>Share</span></button>
    </div>
    <AnimatePresence initial={false}>
      {isExpanded && <motion.form className={styles.commentForm} onSubmit={form.handleSubmit((input) => mutation.mutate(input))} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}>
        {replyTarget && <div className={styles.replyBanner} role="note">
          <div className={styles.replyBannerBody}>
            <span>Replying to <strong>{replyTarget.authorName || "Anonymous"}</strong></span>
            <p>{replyTarget.body}</p>
          </div>
          <button type="button" className={styles.replyBannerCancel} onClick={cancelReply} aria-label="Cancel reply"><X size={14} /></button>
        </div>}
        <div className={styles.commentIdentity}>
          <AvatarPicker seed={identity.avatarSeed || "manifold"} onChange={chooseAvatar} />
          <label>Name <span>(optional)</span><TextField.Root {...form.register("authorName")} placeholder="Anonymous" autoComplete="name" />{form.formState.errors.authorName && <small>{form.formState.errors.authorName.message}</small>}</label>
        </div>
        <label>Website <span>(optional)</span><TextField.Root {...form.register("authorUrl")} placeholder="https://" inputMode="url" autoComplete="url" />{form.formState.errors.authorUrl && <small>{form.formState.errors.authorUrl.message}</small>}</label>
        <label>Comment<TextArea {...form.register("body")} id="comment-body" placeholder="Write a comment" rows={5} />{form.formState.errors.body && <small>{form.formState.errors.body.message}</small>}</label>
        <label>Quick check <span>(what is 3 + 4?)</span><TextField.Root {...form.register("captcha")} inputMode="numeric" placeholder="7" />{form.formState.errors.captcha && <small>{form.formState.errors.captcha.message}</small>}</label>
        {mutation.isError && <p className={styles.errorText}>Could not send the comment. Please try again.</p>}
        <Button className={styles.primaryButton} type="submit" disabled={mutation.isPending}><Send size={15} /> {mutation.isPending ? "Sending..." : "Send comment"}</Button>
        {mutation.isSuccess && <p className={styles.successText}>Posted. Thank you for adding to the thread.</p>}
      </motion.form>}
    </AnimatePresence>
  </motion.div>;
}

export function CommentsSection({ slug, viewCount, likeCount }: { slug: string; viewCount: number; likeCount: number }) {
  const [replyTarget, setReplyTarget] = useState<Comment | null>(null);
  useReplyFocus(replyTarget);
  const reply = useMemo<ReplyContextValue>(() => ({ replyTarget, startReply: setReplyTarget, cancelReply: () => setReplyTarget(null) }), [replyTarget]);
  return <ReplyContext.Provider value={reply}>
    <section className={styles.articleDiscussionBlock} aria-label="Thought discussion">
      <ArticleDiscussion slug={slug} viewCount={viewCount} likeCount={likeCount} />
    </section>
    <section className={styles.articleComposerBlock} data-active="true" aria-label="Add a comment">
      <CommentComposer slug={slug} expanded anchorId="comment-composer" />
    </section>
  </ReplyContext.Provider>;
}
