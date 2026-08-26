"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, Filter, Heart, MessageCircle, Search, Send, Share2 } from "lucide-react";
import { Button, TextArea, TextField } from "@radix-ui/themes";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { Comment } from "@manifold/contracts";
import { createBrowserClient, getVisitorId } from "../lib/api";
import { filterComments, type CommentFilter } from "../lib/comment-filter";
import styles from "../app/site.module.css";
import { ReactionBar } from "./reaction-bar";

const commentSchema = z.object({
  authorName: z.string().trim().max(80),
  authorUrl: z.string().trim().url("Use a complete URL.").or(z.literal("")),
  body: z.string().trim().min(3, "A little more detail would help.").max(4000),
  captcha: z.string().min(1, "Solve the small check."),
}).superRefine((value, context) => { if (value.captcha !== "7") context.addIssue({ code: "custom", path: ["captcha"], message: "Solve the small check." }); });
type CommentForm = z.infer<typeof commentSchema>;

function CommentList({ comments }: { comments: Comment[] }) {
  return <div className={styles.commentList}>
    <AnimatePresence initial={false}>
      {comments.map((comment) => <motion.article key={comment.id} className={styles.comment} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className={styles.commentMeta}><strong>{comment.authorName}</strong><span>{comment.status === "PENDING" ? "Awaiting review" : "Approved"}</span><time dateTime={comment.createdAt}>{new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(comment.createdAt))}</time></div>
        <p>{comment.body}</p>
      </motion.article>)}
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
  const reactions = useQuery({ queryKey: ["reactions", slug, visitorId], queryFn: () => client.reactions(slug, visitorId), enabled: Boolean(visitorId) });
  const comments = useMemo(() => commentsQuery.data?.data ?? [], [commentsQuery.data]);
  const visibleComments = useMemo(() => filterComments(comments, search, filter), [comments, search, filter]);
  const currentLikeCount = reactions.data?.likeCount ?? likeCount;

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

type CommentComposerProps = { slug: string; expanded: boolean; compact?: boolean; onExpandedChange?: (expanded: boolean) => void };

export function CommentComposer({ slug, expanded, compact = false, onExpandedChange }: CommentComposerProps) {
  const client = useMemo(() => createBrowserClient(), []);
  const queryClient = useQueryClient();
  const [localExpanded, setLocalExpanded] = useState(expanded);
  const isExpanded = onExpandedChange ? expanded : localExpanded;
  const form = useForm<CommentForm>({ resolver: zodResolver(commentSchema), defaultValues: { authorName: "", authorUrl: "", body: "", captcha: "" } });
  const mutation = useMutation({
    mutationFn: (input: CommentForm) => client.createComment(slug, { authorName: input.authorName, authorUrl: input.authorUrl || undefined, body: input.body }),
    onSuccess: () => {
      form.reset();
      void queryClient.invalidateQueries({ queryKey: ["comments", slug] });
    },
  });
  const toggleExpanded = () => onExpandedChange ? onExpandedChange(!expanded) : setLocalExpanded((value) => !value);

  return <motion.div layoutId="article-composer" className={styles.articleComposerCard} data-compact={compact ? "true" : "false"} data-expanded={isExpanded ? "true" : "false"}>
    <div className={styles.articleComposerActions}>
      <span className={styles.articleActionLabel}>{compact ? "Leave a trace" : "Add a comment"}</span>
      <ReactionBar slug={slug} compact={compact} />
      <button type="button" className={styles.articleActionButton} aria-expanded={isExpanded} onClick={toggleExpanded}><MessageCircle size={15} /> <span>{isExpanded ? "Hide comment" : "Comment"}</span></button>
      <button type="button" className={styles.articleActionButton} onClick={shareArticle}><Share2 size={15} /> <span>Share</span></button>
    </div>
    <AnimatePresence initial={false}>
      {isExpanded && <motion.form className={styles.commentForm} onSubmit={form.handleSubmit((input) => mutation.mutate(input))} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}>
        <div className={styles.formGrid}>
          <label>Name <span>(optional)</span><TextField.Root {...form.register("authorName")} placeholder="Anonymous" autoComplete="name" />{form.formState.errors.authorName && <small>{form.formState.errors.authorName.message}</small>}</label>
          <label>Website <span>(optional)</span><TextField.Root {...form.register("authorUrl")} placeholder="https://" inputMode="url" autoComplete="url" />{form.formState.errors.authorUrl && <small>{form.formState.errors.authorUrl.message}</small>}</label>
        </div>
        <label>Comment<TextArea {...form.register("body")} placeholder="Write a comment" rows={5} />{form.formState.errors.body && <small>{form.formState.errors.body.message}</small>}</label>
        <label>Quick check <span>(what is 3 + 4?)</span><TextField.Root {...form.register("captcha")} inputMode="numeric" placeholder="7" />{form.formState.errors.captcha && <small>{form.formState.errors.captcha.message}</small>}</label>
        {mutation.isError && <p className={styles.errorText}>Could not send the comment. Please try again.</p>}
        <Button className={styles.primaryButton} type="submit" disabled={mutation.isPending}><Send size={15} /> {mutation.isPending ? "Sending..." : "Send for review"}</Button>
        {mutation.isSuccess && <p className={styles.successText}>Received. It will appear after a quick review.</p>}
      </motion.form>}
    </AnimatePresence>
  </motion.div>;
}

export function CommentThread({ slug }: { slug: string }) {
  return <>
    <ArticleDiscussion slug={slug} showStats={false} />
    <CommentComposer slug={slug} expanded />
  </>;
}
