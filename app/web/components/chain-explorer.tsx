"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Fingerprint, KeyRound, Link2, ShieldCheck } from "lucide-react";
import type { AnchorSource, ChainBlockSummary, ChainInfo, SubmitAnchorResponse, VerifyResponse } from "@manifold/contracts";
import { createBrowserClient } from "../lib/api";
import styles from "../app/site.module.css";

type BlocksPage = { items: ChainBlockSummary[]; page: number; totalPages: number };

type VerifyResult = {
  mode: "hash" | "payload" | "content";
  input: string;
  response: VerifyResponse | null;
  error: string | null;
};

const SOURCE_COLORS: Record<AnchorSource, string> = {
  content: "var(--color-accent)",
  comment: "var(--color-ink)",
  reaction: "var(--color-muted)",
  profile: "var(--color-muted)",
  site: "var(--color-muted)",
  media: "var(--color-muted)",
  auth: "var(--color-muted)",
  visitor: "var(--color-accent)",
  admin: "var(--color-ink)",
};

export function ChainExplorer({ info, initialBlocks }: { info: ChainInfo | null; initialBlocks: BlocksPage | null }) {
  const [blocks, setBlocks] = useState<BlocksPage | null>(initialBlocks);
  const [page, setPage] = useState(initialBlocks?.page ?? 1);
  const [selectedBlock, setSelectedBlock] = useState<{ id: string; certIds: string[]; anchors: Array<{ id: string; source: AnchorSource; label: string; subjectHash: string; status: string }> } | null>(null);
  const [payloadInput, setPayloadInput] = useState("");
  const [hashInput, setHashInput] = useState("");
  const [submitResult, setSubmitResult] = useState<SubmitAnchorResponse | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);

  const client = useMemo(() => createBrowserClient(), []);

  const loadBlocks = useCallback(async (targetPage: number) => {
    try {
      const result = await client.chainBlocks({ page: targetPage, pageSize: 20 });
      setBlocks({ items: result.data, page: result.pagination.page, totalPages: result.pagination.totalPages });
    } catch {
      setBlocks(null);
    }
  }, [client]);

  // Reload the block list when the page changes beyond the server-rendered
  // first page; fetching happens inside the async callback, not as a direct
  // synchronous setState in the effect body.
  useEffect(() => {
    if (initialBlocks && page === initialBlocks.page) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await client.chainBlocks({ page, pageSize: 20 });
        if (!cancelled) setBlocks({ items: result.data, page: result.pagination.page, totalPages: result.pagination.totalPages });
      } catch {
        if (!cancelled) setBlocks(null);
      }
    })();
    return () => { cancelled = true; };
  }, [page, initialBlocks, client]);

  const openBlock = async (id: string) => {
    if (selectedBlock?.id === id) {
      setSelectedBlock(null);
      return;
    }
    try {
      const detail = await client.chainBlock(id);
      setSelectedBlock({ id, certIds: detail.certIds, anchors: detail.anchors.map((anchor) => ({ id: anchor.id, source: anchor.source, label: anchor.label, subjectHash: anchor.subjectHash, status: anchor.status })) });
    } catch {
      setSelectedBlock(null);
    }
  };

  const submit = async () => {
    if (!payloadInput.trim()) return;
    setBusy(true);
    setSubmitResult(null);
    try {
      setSubmitResult(await client.submitAnchor({ payload: payloadInput, label: "" }));
      setPayloadInput("");
      void loadBlocks(page);
    } catch (error) {
      setSubmitResult(null);
      setVerify((previous) => previous ?? null);
      // Surface API failures inline without crashing the explorer.
      console.warn("anchor submit failed", error);
    } finally {
      setBusy(false);
    }
  };

  const runVerify = async (mode: VerifyResult["mode"], input: string) => {
    setBusy(true);
    setVerify({ mode, input, response: null, error: null });
    try {
      let response: VerifyResponse;
      if (mode === "hash") {
        response = await client.verifyByHash(input.trim());
      } else if (mode === "payload") {
        response = await client.verifyPayload(input);
      } else {
        response = await client.verifyContent(input.trim());
      }
      setVerify({ mode, input, response, error: null });
    } catch (error) {
      setVerify({ mode, input, response: null, error: error instanceof Error ? error.message : "verification failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.chainBody}>
      <section className={styles.chainOverview} aria-label="Chain overview">
        <div><span><Boxes size={13} aria-hidden="true" /> Height</span><strong>{info ? info.height : "—"}</strong></div>
        <div><span><Fingerprint size={13} aria-hidden="true" /> Anchors</span><strong>{info ? info.totalAnchors : "—"}{info && info.pendingAnchors > 0 ? ` (+${info.pendingAnchors} pending)` : ""}</strong></div>
        <div><span><ShieldCheck size={13} aria-hidden="true" /> PoW</span><strong>{info ? `${info.proofMode}${info.proofMode === "proof" ? ` · ${info.difficulty} zeros` : ""}` : "—"}</strong></div>
        <div><span><KeyRound size={13} aria-hidden="true" /> Site key</span><strong className={styles.chainMono}>{info ? shortHash(info.sitePublicKey) : "—"}</strong></div>
      </section>

      <section className={styles.chainSection} aria-label="Verify a commitment">
        <h2>Verify</h2>
        <p>Paste what you submitted — Core hashes it server-side and looks the commitment up on chain. Nothing is computed in your browser.</p>
        <div className={styles.chainVerifyGrid}>
          <label>
            <span>Payload text</span>
            <textarea rows={3} value={payloadInput} onChange={(event) => setPayloadInput(event.target.value)} placeholder="Paste any text you anchored…" />
          </label>
          <div>
            <span>Or look up by</span>
            <div className={styles.chainVerifyActions}>
              <input value={hashInput} onChange={(event) => setHashInput(event.target.value)} placeholder="sha256 hex · or content slug" className={styles.chainMono} />
              <button type="button" disabled={busy || hashInput.trim().length !== 64} onClick={() => runVerify("hash", hashInput)}>By hash</button>
              <button type="button" disabled={busy || hashInput.trim().length === 0} onClick={() => runVerify("content", hashInput)}>By slug</button>
            </div>
            <button type="button" className={styles.chainPrimary} disabled={busy || !payloadInput.trim()} onClick={() => runVerify("payload", payloadInput)}>Verify payload</button>
          </div>
        </div>
        {verify ? <VerifyOutcome outcome={verify} /> : null}
      </section>

      <section className={styles.chainSection} aria-label="Anchor a payload">
        <h2>Anchor</h2>
        <p>Submit any text as a public commitment. It is hashed immediately, the original is discarded, and the certificate is sealed into the next block.</p>
        <div className={styles.chainVerifyActions}>
          <textarea rows={2} value={payloadInput} onChange={(event) => setPayloadInput(event.target.value)} placeholder="Anything worth proving existed…" />
          <button type="button" className={styles.chainPrimary} disabled={busy || !payloadInput.trim()} onClick={submit}>Anchor it</button>
        </div>
        {submitResult ? (
          <p className={styles.chainSubmitResult}>
            Submitted <code className={styles.chainMono}>{shortHash(submitResult.anchorId)}</code> — status <strong>{submitResult.status}</strong>.
            Verify it below once the miner seals a block (usually within 30s).
          </p>
        ) : null}
      </section>

      <section className={styles.chainSection} aria-label="Blocks">
        <h2>Blocks</h2>
        {blocks === null ? (
          <p className={styles.chainEmpty}>The chain is not reachable right now.</p>
        ) : blocks.items.length === 0 ? (
          <p className={styles.chainEmpty}>No blocks yet — the miner mints a genesis block on the first tick.</p>
        ) : (
          <ul className={styles.chainBlockList}>
            {blocks.items.map((block) => (
              <li key={block.id}>
                <button type="button" className={styles.chainBlockRow} onClick={() => void openBlock(block.id)} aria-expanded={selectedBlock?.id === block.id}>
                  <span className={styles.chainBlockIndex}>#{block.index}</span>
                  <span className={styles.chainMono}>{shortHash(block.hash)}</span>
                  <span>{block.anchorCount} {block.anchorCount === 1 ? "anchor" : "anchors"}</span>
                  <span className={styles.chainBlockMode}>{block.proofMode}{block.proofMode === "proof" ? `·${block.difficulty}` : ""}</span>
                  <span className={styles.chainBlockTime}>{block.timestamp.replace("T", " ").replace("Z", " UTC")}</span>
                </button>
                {selectedBlock?.id === block.id ? (
                  <div className={styles.chainBlockDetail}>
                    {selectedBlock.anchors.length === 0 ? (
                      <p className={styles.chainEmpty}>Genesis carries no certificates.</p>
                    ) : (
                      <ul>
                        {selectedBlock.anchors.map((anchor) => (
                          <li key={anchor.id}>
                            <span style={{ color: SOURCE_COLORS[anchor.source] }}>{anchor.source}</span>
                            <code className={styles.chainMono}>{shortHash(anchor.subjectHash)}</code>
                            <span>{anchor.status}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className={styles.chainBlockPrev}>prev <code className={styles.chainMono}>{shortHash(blocks.items.find((item) => item.id === block.id)?.prevHash ?? "")}</code></p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {blocks && blocks.totalPages > 1 ? (
          <div className={styles.chainPager}>
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Earlier</button>
            <span>{page} / {blocks.totalPages}</span>
            <button type="button" disabled={page >= (blocks.totalPages ?? 1)} onClick={() => setPage(page + 1)}>Later →</button>
          </div>
        ) : null}
      </section>

      <p className={styles.chainFootnote}>
        <Link2 size={12} aria-hidden="true" /> Verification replays the full chain on every check: block hashes,
        prev-hash linkage, merkle roots, and every certificate signature.
      </p>
    </div>
  );
}

function VerifyOutcome({ outcome }: { outcome: VerifyResult }) {
  if (outcome.error) {
    return <p className={styles.chainVerifyResult} data-verdict="error">{outcome.error}</p>;
  }
  const response = outcome.response;
  if (!response) return null;
  const verdict = response.found && response.signatureValid && response.chainIntegrity ? "verified" : response.found ? "mismatch" : "not-found";
  return (
    <div className={styles.chainVerifyResult} data-verdict={verdict}>
      <p>
        <strong>{verdict === "verified" ? "✓ Verified on chain" : verdict === "mismatch" ? "⚠ Found, but checks failed" : "✗ No such commitment"}</strong>
      </p>
      <p>
        signature {response.signatureValid ? "valid" : "invalid"} · chain {response.chainIntegrity ? "intact" : "tampered"}
        {response.anchor ? <> · anchored in <code className={styles.chainMono}>{response.anchor.blockId ?? "pending"}</code></> : null}
      </p>
      {response.anchor ? (
        <p>
          {response.anchor.source} {response.anchor.label ? `“${response.anchor.label}” ` : ""}· {response.anchor.createdAt.replace("T", " ").replace("Z", " UTC")}
        </p>
      ) : null}
    </div>
  );
}

function shortHash(value: string): string {
  if (!value) return "—";
  return value.length <= 18 ? value : `${value.slice(0, 10)}…${value.slice(-6)}`;
}
