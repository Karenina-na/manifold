import { useCallback, useEffect, useState } from "react";
import type { VerifyResponse } from "@manifold/contracts";

export type PendingCommit = {
  anchorId: string;
  subjectHash: string;
  label: string;
  payload: string;
  at: string;
  status: "pending" | "anchored";
  blockId: string | null;
};

type PendingCommitVerifier = {
  verifyByHash: (hash: string) => Promise<VerifyResponse>;
};

const STORAGE_KEY = "manifold.chain.pendingCommits";
const MAX_PENDING_COMMITS = 8;

export function appendPendingCommit(current: PendingCommit[], commit: PendingCommit) {
  return [...current, commit].slice(-MAX_PENDING_COMMITS);
}

function persistPendingCommits(commits: PendingCommit[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(commits));
  } catch {
    // The in-memory list remains available when browser storage is unavailable.
  }
}

export function usePendingCommits(client: PendingCommitVerifier) {
  const [pendingCommits, setPendingCommits] = useState<PendingCommit[]>([]);

  useEffect(() => {
    let cancelled = false;
    let saved: PendingCommit[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) saved = JSON.parse(raw) as PendingCommit[];
    } catch {
      saved = [];
    }

    const restoreTimer = window.setTimeout(() => {
      if (!cancelled) setPendingCommits(saved);
    }, 0);

    void (async () => {
      for (const commit of saved) {
        if (commit.status !== "pending") continue;
        try {
          const result = await client.verifyByHash(commit.subjectHash);
          if (!cancelled && result.found && result.anchor?.blockId) {
            setPendingCommits((current) => {
              const next = current.map((item) => item.anchorId === commit.anchorId
                ? { ...item, status: "anchored" as const, blockId: result.anchor?.blockId ?? null }
                : item);
              persistPendingCommits(next);
              return next;
            });
          }
        } catch {
          // A later visit retries commitments that could not be verified now.
        }
        await new Promise((resolve) => window.setTimeout(resolve, 300));
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(restoreTimer);
    };
  }, [client]);

  const addPendingCommit = useCallback((commit: PendingCommit) => {
    setPendingCommits((current) => {
      const next = appendPendingCommit(current, commit);
      persistPendingCommits(next);
      return next;
    });
  }, []);

  return { pendingCommits, addPendingCommit };
}
