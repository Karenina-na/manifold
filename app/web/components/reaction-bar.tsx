"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Heart } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactionKind, ReactionSummary } from "@manifold/contracts";
import { createBrowserClient, getVisitorId } from "../lib/api";
import styles from "../app/site.module.css";

type ReactionBarProps = { slug: string };

export function ReactionBar({ slug }: ReactionBarProps) {
  const client = useMemo(() => createBrowserClient(), []);
  const [visitorId, setVisitorId] = useState("");
  useEffect(() => setVisitorId(getVisitorId()), []);
  const queryClient = useQueryClient();
  const queryKey = ["reactions", slug, visitorId];
  const query = useQuery({ queryKey, queryFn: () => client.reactions(slug, visitorId), enabled: Boolean(visitorId) });
  const mutation = useMutation({
    mutationFn: ({ kind, enabled }: { kind: ReactionKind; enabled: boolean }) => client.setReaction(slug, kind, visitorId, enabled),
    onMutate: async ({ kind, enabled }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ReactionSummary>(queryKey);
      queryClient.setQueryData<ReactionSummary>(queryKey, (current) => {
        const summary = current ?? { likeCount: 0, favoriteCount: 0, viewerLiked: false, viewerFavorited: false };
        if (kind === "LIKE") return { ...summary, likeCount: Math.max(0, summary.likeCount + (enabled === summary.viewerLiked ? 0 : enabled ? 1 : -1)), viewerLiked: enabled };
        return { ...summary, favoriteCount: Math.max(0, summary.favoriteCount + (enabled === summary.viewerFavorited ? 0 : enabled ? 1 : -1)), viewerFavorited: enabled };
      });
      return { previous };
    },
    onError: (_error, _variables, context) => queryClient.setQueryData(queryKey, context?.previous),
    onSuccess: (summary) => queryClient.setQueryData(queryKey, summary),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const summary = query.data ?? { likeCount: 0, favoriteCount: 0, viewerLiked: false, viewerFavorited: false };
  const toggle = (kind: ReactionKind, enabled: boolean) => { if (visitorId) mutation.mutate({ kind, enabled }); };
  return <div className={styles.reactionBar} aria-label="Reactions">
    <button className={`${styles.reactionButton} ${summary.viewerLiked ? styles.reactionButtonActive : ""}`} type="button" aria-pressed={summary.viewerLiked} aria-label={`${summary.viewerLiked ? "Remove" : "Add"} like`} onClick={() => toggle("LIKE", !summary.viewerLiked)} disabled={mutation.isPending}>
      <Heart size={16} fill={summary.viewerLiked ? "currentColor" : "none"} /> <span>{summary.likeCount}</span>
    </button>
    <button className={`${styles.reactionButton} ${summary.viewerFavorited ? styles.reactionButtonActive : ""}`} type="button" aria-pressed={summary.viewerFavorited} aria-label={`${summary.viewerFavorited ? "Remove" : "Add"} favorite`} onClick={() => toggle("FAVORITE", !summary.viewerFavorited)} disabled={mutation.isPending}>
      <Bookmark size={16} fill={summary.viewerFavorited ? "currentColor" : "none"} /> <span>{summary.favoriteCount}</span>
    </button>
    {query.isError && <span className={styles.reactionError}>Reactions unavailable</span>}
  </div>;
}
