"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { Button } from "@radix-ui/themes";
import { useMemo, useState } from "react";
import type { LikeSummary } from "@manifold/contracts";
import { createBrowserClient, getVisitorId } from "../lib/api";
import styles from "../app/site.module.css";

type LikeButtonProps = { slug: string; compact?: boolean };

export function LikeButton({ slug, compact = false }: LikeButtonProps) {
  const client = useMemo(() => createBrowserClient(), []);
  const [visitorId] = useState(() => typeof window === "undefined" ? "" : getVisitorId());
  const queryClient = useQueryClient();
  const queryKey = ["likes", slug, visitorId];
  const query = useQuery({ queryKey, queryFn: () => client.likes(slug, visitorId), enabled: Boolean(visitorId) });
  const mutation = useMutation({
    mutationFn: ({ enabled }: { enabled: boolean }) => client.setLike(slug, visitorId, enabled),
    onMutate: async ({ enabled }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<LikeSummary>(queryKey);
      queryClient.setQueryData<LikeSummary>(queryKey, (current) => {
        const summary = current ?? { likeCount: 0, viewerLiked: false };
        return { ...summary, likeCount: Math.max(0, summary.likeCount + (enabled === summary.viewerLiked ? 0 : enabled ? 1 : -1)), viewerLiked: enabled };
      });
      return { previous };
    },
    onError: (_error, _variables, context) => queryClient.setQueryData(queryKey, context?.previous),
    onSuccess: (summary) => queryClient.setQueryData(queryKey, summary),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const summary = query.data ?? { likeCount: 0, viewerLiked: false };
  const toggle = (enabled: boolean) => { if (visitorId) mutation.mutate({ enabled }); };
  return <div className={`${styles.likeBar} ${compact ? styles.likeBarCompact : ""}`} aria-label="Like">
    <Button className={`${styles.likeButton} ${summary.viewerLiked ? styles.likeButtonActive : ""}`} variant="soft" type="button" aria-pressed={summary.viewerLiked} aria-label={`${summary.viewerLiked ? "Remove" : "Add"} like`} onClick={() => toggle(!summary.viewerLiked)} disabled={mutation.isPending}>
      <Heart size={16} fill={summary.viewerLiked ? "currentColor" : "none"} /> <span>{summary.likeCount}</span>
    </Button>
    {query.isError && <span className={styles.likeError}>Likes unavailable</span>}
  </div>;
}
