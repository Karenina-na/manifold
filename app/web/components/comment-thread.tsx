"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Send } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { Comment } from "@manifold/contracts";
import { createBrowserClient } from "../lib/api";
import styles from "../app/site.module.css";

const commentSchema = z.object({
  authorName: z.string().trim().min(2, "Please add your name.").max(80),
  authorUrl: z.string().trim().url("Use a complete URL.").or(z.literal("")),
  body: z.string().trim().min(3, "A little more detail would help.").max(4000),
});
type CommentForm = z.infer<typeof commentSchema>;

export function CommentThread({ slug }: { slug: string }) {
  const client = createBrowserClient();
  const queryClient = useQueryClient();
  const [localPending, setLocalPending] = useState<Comment[]>([]);
  const commentsQuery = useQuery({ queryKey: ["comments", slug], queryFn: () => client.comments(slug) });
  const form = useForm<CommentForm>({ resolver: zodResolver(commentSchema), defaultValues: { authorName: "", authorUrl: "", body: "" } });
  const mutation = useMutation({
    mutationFn: (input: CommentForm) => client.createComment(slug, { authorName: input.authorName, authorUrl: input.authorUrl || undefined, body: input.body }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["comments", slug] });
      setLocalPending((items) => [...items, { id: `pending-${Date.now()}`, contentId: slug, authorName: input.authorName, authorUrl: input.authorUrl || undefined, body: input.body, status: "PENDING", createdAt: new Date().toISOString() }]);
    },
    onSuccess: (comment) => {
      setLocalPending((items) => items.map((item) => item.authorName === comment.authorName && item.body === comment.body ? comment : item));
      form.reset();
    },
  });
  const comments = [...localPending, ...(commentsQuery.data?.data ?? [])];

  return <section className={styles.commentSection} aria-labelledby="comments-title">
    <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Conversation</span><h2 id="comments-title">Leave a thoughtful trace</h2></div><span className={styles.commentCount}>{comments.length}</span></div>
    {commentsQuery.isLoading && <p className={styles.muted}>Loading responses...</p>}
    {commentsQuery.isError && <p className={styles.errorText}>Responses are unavailable at the moment.</p>}
    {!commentsQuery.isLoading && !commentsQuery.isError && comments.length === 0 && <p className={styles.muted}>No responses yet. Start the thread.</p>}
    <div className={styles.commentList}><AnimatePresence initial={false}>{comments.map((comment) => <motion.article key={comment.id} className={styles.comment} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><div className={styles.commentMeta}><strong>{comment.authorName}</strong><span>{comment.status === "PENDING" ? "Awaiting review" : "Approved"}</span></div><p>{comment.body}</p></motion.article>)}</AnimatePresence></div>
    <form className={styles.commentForm} onSubmit={form.handleSubmit((input) => mutation.mutate(input))}>
      <div className={styles.formGrid}>
        <label>Name<input {...form.register("authorName")} placeholder="Your name" autoComplete="name" />{form.formState.errors.authorName && <small>{form.formState.errors.authorName.message}</small>}</label>
        <label>Website <span>(optional)</span><input {...form.register("authorUrl")} placeholder="https://" inputMode="url" autoComplete="url" />{form.formState.errors.authorUrl && <small>{form.formState.errors.authorUrl.message}</small>}</label>
      </div>
      <label>Response<textarea {...form.register("body")} placeholder="What stayed with you?" rows={5} />{form.formState.errors.body && <small>{form.formState.errors.body.message}</small>}</label>
      {mutation.isError && <p className={styles.errorText}>Could not send this yet. Your draft is still here.</p>}
      <button className={styles.primaryButton} type="submit" disabled={mutation.isPending}><Send size={15} /> {mutation.isPending ? "Sending..." : "Send for review"}</button>
      {mutation.isSuccess && <p className={styles.successText}>Received. It will appear after a quick review.</p>}
    </form>
  </section>;
}
