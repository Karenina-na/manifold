"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, BadgeCheck, Boxes, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Copy, Cpu, Fingerprint, Hash, KeyRound, Layers, Link2, ScanLine, ShieldCheck } from "lucide-react";
import type { AnchorSource, ChainAnchor, ChainBlockDetail, ChainBlockSummary, ChainInfo, VerifyChainContext, VerifyMerkleProof, VerifyResponse, VerifyStep } from "@manifold/contracts";
import { ApiError } from "@manifold/sdk";
import { usePendingCommits, type PendingCommit } from "../features/chain/use-pending-commits";
import { createBrowserClient } from "../lib/api";
import { Pagination } from "./pagination";
import { Reveal } from "./reveal";
import styles from "../app/site.module.css";

type BlocksPage = { items: ChainBlockSummary[]; page: number; totalPages: number };
type VerifyMode = "payload" | "hash" | "content";
type BlockDetail = { id: string; certIds: string[]; anchors: ChainAnchor[] };

type VerifyResult = {
  mode: VerifyMode;
  input: string;
  response: VerifyResponse | null;
  error: string | null;
};

const VERIFY_MODES: Array<{ id: VerifyMode; label: string; placeholder: string }> = [
  { id: "payload", label: "Payload", placeholder: "Paste the exact text you anchored…" },
  { id: "hash", label: "SHA-256", placeholder: "64 hex characters…" },
  { id: "content", label: "Slug", placeholder: "content slug, e.g. a-small-signal" },
];

// Client-side pacing so a held-down button cannot outrun Core's limiter: every
// verify call replays the whole chain server-side, so the cool-down after a
// request is deliberately longer than the one after a submission.
const VERIFY_COOLDOWN_MS = 4_000;
const ANCHOR_COOLDOWN_MS = 10_000;
const RATE_LIMIT_COOLDOWN_MS = 30_000;

const SOURCE_DOTS: Record<AnchorSource, string> = {
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
  // The block page lives in the URL (?page=N) so browser back/forward (e.g.
  // after jumping to a certificate's content) restores the exact page state.
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlPage = Math.min(Math.max(1, Number(searchParams.get("page")) || 1), initialBlocks?.totalPages ?? 1);
  const [blocks, setBlocks] = useState<BlocksPage | null>(initialBlocks);
  // The block page lives in the URL (?page=N) and is derived from it each
  // render, so back/forward navigation restores the exact page without a
  // state-sync effect.
  const page = urlPage;
  // The whole sealed chain (pageSize 100 clamps at Core), loaded once so the
  // spine can scroll the entire sequence instead of depending on the ledger
  // pagination below. Refreshed after a fresh commit lands a new block.
  const [fullBlocks, setFullBlocks] = useState<ChainBlockSummary[] | null>(null);
  const [spineRefresh, setSpineRefresh] = useState(0);
  const [openBlock, setOpenBlock] = useState<BlockDetail | null>(null);
  const [spineId, setSpineId] = useState<string | null>(initialBlocks?.items[0]?.id ?? null);
  const [mode, setMode] = useState<VerifyMode>("payload");
  const [verifyInput, setVerifyInput] = useState("");
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [payload, setPayload] = useState("");
  const [label, setLabel] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyUntil, setVerifyUntil] = useState(0);
  const [anchorUntil, setAnchorUntil] = useState(0);
  const [now, setNow] = useState(0);

  const client = useMemo(() => createBrowserClient(), []);
  const { pendingCommits, addPendingCommit } = usePendingCommits(client);
  const totalPages = blocks?.totalPages ?? 1;

  // Ticks only while a cool-down is pending so the buttons can count down.
  useEffect(() => {
    const until = Math.max(verifyUntil, anchorUntil);
    if (until <= Date.now()) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [verifyUntil, anchorUntil]);

  // Reload the block list whenever the requested page differs from the page we
  // currently hold — including back to page 1 after Next, which the
  // server-rendered first page must not short-circuit (otherwise Prev would
  // leave the stale page-2 list on screen).
  useEffect(() => {
    if (blocks && blocks.page === page) return;
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
  }, [page, blocks, client]);

  // Blocks arrive newest-first, so the spine reads genesis → tip left to right.
  // It renders the full sealed chain (not just the current ledger page) and
  // scrolls horizontally.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await client.chainBlocks({ page: 1, pageSize: 100 });
        if (!cancelled) setFullBlocks(result.data);
      } catch {
        if (!cancelled) setFullBlocks(null);
      }
    })();
    return () => { cancelled = true; };
  }, [client, spineRefresh]);

  const spine = (() => {
    const source = fullBlocks ?? blocks?.items ?? [];
    return [...source].reverse();
  })();
  const spineScroller = useRef<HTMLDivElement | null>(null);
  const spineBlock = spine.find((block) => block.id === spineId) ?? spine[spine.length - 1] ?? null;

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1600);
    } catch {
      setCopied(null);
    }
  };

  const toggleBlock = async (id: string) => {
    if (openBlock?.id === id) {
      setOpenBlock(null);
      return;
    }
    try {
      const detail = await client.chainBlock(id);
      setOpenBlock({ id, certIds: detail.certIds, anchors: detail.anchors });
    } catch {
      setOpenBlock(null);
    }
  };

  const changePage = (next: number) => {
    const clamped = Math.min(Math.max(1, next), totalPages);
    if (clamped === page) return;
    router.replace(clamped === 1 ? "/chain" : `/chain?page=${clamped}`, { scroll: false });
  };

  // Spine → ledger: bring the chosen block row onto the current page (spine is
  // tip-side), expand its certificates, then scroll it into view. When the
  // block lives on an older page, its index locates that page (blocks are
  // listed newest-first at 20/page).
  const openInLedger = async (blockId: string) => {
    let detail: ChainBlockDetail | null = null;
    try {
      detail = await client.chainBlock(blockId);
    } catch {
      setOpenBlock(null);
      return;
    }
    const onPage = blocks?.items.some((block) => block.id === blockId) ?? false;
    if (!onPage && detail) {
      const topIndex = blocks?.items[0]?.index ?? 0;
      const pageSize = 20;
      const targetPage = Math.max(1, Math.floor((topIndex - detail.index) / pageSize) + 1);
      if (targetPage !== page) {
        try {
          const result = await client.chainBlocks({ page: targetPage, pageSize });
          setBlocks({ items: result.data, page: result.pagination.page, totalPages: result.pagination.totalPages });
          router.replace(targetPage === 1 ? "/chain" : `/chain?page=${targetPage}`, { scroll: false });
        } catch {
          // keep the current list; the detail may still open below
        }
      }
    }
    setOpenBlock({ id: blockId, certIds: detail.certIds, anchors: detail.anchors });
    // Let the expanded row render before scrolling to it.
    window.setTimeout(() => {
      document.getElementById(`ledger-block-${blockId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  // Deep link from a detail page badge: /chain?block=<id>. Select that block in
  // the Sealed sequence when it is on screen, otherwise expand its ledger row
  // (older blocks fall outside the spine window). Declared after the helpers it
  // closes over; the restore is deferred so it never runs during the effect
  // phase itself.
  useEffect(() => {
    const blockId = searchParams.get("block");
    if (!blockId || !blocks) return;
    let timer = 0;
    if (spine.some((block) => block.id === blockId)) {
      timer = window.setTimeout(() => {
        setSpineId(blockId);
        document.getElementById("sealed-sequence")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    } else {
      timer = window.setTimeout(() => { void openInLedger(blockId); }, 0);
    }
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runVerify = async () => {
    const input = verifyInput.trim();
    if (!input || Date.now() < verifyUntil) return;
    setBusy(true);
    setVerify({ mode, input, response: null, error: null });
    try {
      const response = mode === "payload" ? await client.verifyPayload(verifyInput) : mode === "hash" ? await client.verifyByHash(input) : await client.verifyContent(input);
      setVerify({ mode, input, response, error: null });
      setVerifyUntil(Date.now() + VERIFY_COOLDOWN_MS);
    } catch (error) {
      const outcome = describeFailure(error);
      setVerify({ mode, input, response: null, error: outcome.message });
      setVerifyUntil(Date.now() + (outcome.rateLimited ? RATE_LIMIT_COOLDOWN_MS : VERIFY_COOLDOWN_MS));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!payload.trim() || Date.now() < anchorUntil) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const result = await client.submitAnchor({ payload, label: label.trim() });
      const commit: PendingCommit = {
        anchorId: result.anchorId,
        subjectHash: result.subjectHash,
        label: label.trim(),
        payload,
        at: new Date().toISOString(),
        status: "pending",
        blockId: null,
      };
      addPendingCommit(commit);
      setPayload("");
      setLabel("");
      setAnchorUntil(Date.now() + ANCHOR_COOLDOWN_MS);
      const list = await client.chainBlocks({ page, pageSize: 20 });
      setBlocks({ items: list.data, page: list.pagination.page, totalPages: list.pagination.totalPages });
      setSpineRefresh((current) => current + 1);
    } catch (error) {
      const outcome = describeFailure(error);
      setSubmitError(outcome.message);
      setAnchorUntil(Date.now() + (outcome.rateLimited ? RATE_LIMIT_COOLDOWN_MS : ANCHOR_COOLDOWN_MS));
    } finally {
      setBusy(false);
    }
  };

  const verifyReady = mode === "hash" ? verifyInput.trim().length === 64 : verifyInput.trim().length > 0;
  const verifyRemaining = remainingSeconds(verifyUntil, now);
  const anchorRemaining = remainingSeconds(anchorUntil, now);

  return (
    <div className={styles.chainBody}>
      <Reveal className={styles.chainReveal}>
        <section className={styles.chainPanel} aria-label="Chain overview">
          <div className={styles.chainStats}>
            <Stat icon={<Boxes size={12} aria-hidden="true" />} label="Height" value={info ? String(info.height) : "—"} sub="sealed blocks" />
            <Stat icon={<Fingerprint size={12} aria-hidden="true" />} label="Commitments" value={info ? String(info.totalAnchors) : "—"} sub={info ? `${info.pendingAnchors} in mempool` : "—"} />
            <Stat icon={<Cpu size={12} aria-hidden="true" />} label="Proof" value={info ? info.proofMode : "—"} sub={info && info.proofMode === "proof" ? `${info.difficulty} leading zeros` : info ? "trivial target" : "—"} />
            <Stat icon={<KeyRound size={12} aria-hidden="true" />} label="Site key" value={<span className={styles.chainMono}>{info ? shortHash(info.sitePublicKey) : "—"}</span>} sub="ed25519 public" />
          </div>
          <div className={styles.chainLinkStrip}>
            <span>genesis</span>
            <code className={styles.chainMono}>{info ? shortHash(info.genesisHash, 12) : "—"}</code>
            <span className={styles.chainLinkRule} aria-hidden="true" />
            <span>tip</span>
            <code className={styles.chainMono}>{info ? shortHash(info.tipHash, 12) : "—"}</code>
          </div>
        </section>
      </Reveal>

      <Reveal className={styles.chainReveal}>
        <section className={styles.chainPanel} aria-label="Block spine" id="sealed-sequence">
          <div className={styles.chainPanelHead}>
            <div>
              <span className={styles.eyebrow}>◇ Spine</span>
              <h2>Sealed sequence</h2>
            </div>
            <span className={styles.chainPanelHint}>{spine.length} of {info?.height ?? 0} blocks</span>
          </div>
          {spine.length === 0 ? (
            <p className={styles.chainEmpty}>The chain is not reachable right now.</p>
          ) : (
            <>
              <div className={styles.chainSpineNav}>
                <button type="button" className={styles.chainSpineNavBtn} aria-label="Scroll spine toward genesis" onClick={() => spineScroller.current?.scrollBy({ left: -(spineScroller.current.clientWidth * 0.7), behavior: "smooth" })}>
                  <ChevronLeft size={14} aria-hidden="true" />
                </button>
                <div ref={spineScroller} className={styles.chainSpine} role="tablist" aria-label="Chain blocks">
                  {spine.map((block, index) => (
                    <div key={block.id} className={styles.chainSpineSlot}>
                      {index > 0 ? <span className={styles.chainSpineLink} aria-hidden="true" /> : null}
                      <button
                        type="button"
                        role="tab"
                        aria-selected={spineBlock?.id === block.id}
                        className={styles.chainSpineNode}
                        data-tip={index === spine.length - 1}
                        data-selected={spineBlock?.id === block.id}
                        onClick={() => setSpineId(block.id)}
                      >
                        <span className={styles.chainSpineCube} aria-hidden="true">{block.index}</span>
                        <span className={styles.chainSpineMeta}>{shortHash(block.hash, 6)}</span>
                        <span className={styles.chainSpineMeta}>{block.anchorCount}×</span>
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" className={styles.chainSpineNavBtn} aria-label="Scroll spine toward tip" onClick={() => spineScroller.current?.scrollBy({ left: spineScroller.current.clientWidth * 0.7, behavior: "smooth" })}>
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </div>
              {spineBlock ? (
                <div className={styles.chainSpineDetail}>
                  <Field label="Block" value={`#${spineBlock.index}`} />
                  <Field label="Hash" value={<HashLine value={spineBlock.hash} />} />
                  <Field label="Prev hash" value={<HashLine value={spineBlock.prevHash} />} />
                  <Field label="Merkle root" value={<HashLine value={spineBlock.certRoot} />} />
                  <Field label="Nonce" value={String(spineBlock.nonce)} />
                  <Field label="Target" value={spineBlock.proofMode === "proof" ? `${spineBlock.difficulty} zeros` : "sim"} />
                  <Field label="Certificates" value={`${spineBlock.anchorCount}`} />
                  <Field label="Sealed" wide value={<span><Clock size={10} aria-hidden="true" /> {formatUtc(spineBlock.timestamp)}</span>} />
                  <button type="button" className={styles.chainSpineJump} onClick={() => void openInLedger(spineBlock.id)}>
                    <ArrowRight size={12} aria-hidden="true" /> Open block #{spineBlock.index} in ledger
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </Reveal>

      <Reveal className={styles.chainReveal}>
        <section className={styles.chainPanel} aria-label="Verify a commitment">
          <div className={styles.chainPanelHead}>
            <div>
              <span className={styles.eyebrow}>✦ Verify</span>
              <h2>Prove a commitment</h2>
            </div>
            <span className={styles.chainPanelHint}>sha256 · ed25519 · replay</span>
          </div>
          <div className={styles.chainVerifyGrid}>
            <div className={styles.chainVerifyLeft} data-verify-left>
              <div className={styles.chainSegmented} role="tablist" aria-label="Verification mode">
                {VERIFY_MODES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={mode === item.id}
                    className={mode === item.id ? `${styles.chainSegment} ${styles.chainSegmentActive}` : styles.chainSegment}
                    onClick={() => { setMode(item.id); setVerify(null); }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {mode === "payload" ? (
                <textarea className={styles.chainTextarea} rows={3} value={verifyInput} onChange={(event) => setVerifyInput(event.target.value)} placeholder={VERIFY_MODES[0].placeholder} />
              ) : (
                <input className={styles.chainInput} value={verifyInput} onChange={(event) => setVerifyInput(event.target.value)} placeholder={VERIFY_MODES.find((item) => item.id === mode)?.placeholder} />
              )}
              <div className={styles.chainActions}>
                <button type="button" className={styles.chainButtonPrimary} disabled={busy || !verifyReady || verifyRemaining > 0} onClick={() => void runVerify()}>
                  <ScanLine size={12} aria-hidden="true" /> {verifyRemaining > 0 ? `Retry in ${verifyRemaining}s` : "Run verification"}
                </button>
                {verifyRemaining > 0 ? <span className={styles.chainActionsHint} data-tone="warn">Paced — verification replays the whole chain.</span> : null}
              </div>
              {verify ? <VerifyReceipt result={verify} onCopy={copy} copied={copied} onOpenBlock={(id) => void openInLedger(id)} /> : null}
            </div>
            <div className={styles.chainVerifyRight} data-verify-right>
              <VerifyProcessGraph steps={verify?.response?.steps ?? null} merkle={verify?.response?.merkle ?? null} context={verify?.response?.context ?? null} running={busy} verdict={verify?.response?.found && verify.response.signatureValid && verify.response.chainIntegrity ? "verified" : verify?.response?.found ? "mismatch" : "idle"} />
            </div>
          </div>
        </section>
      </Reveal>

      <Reveal className={styles.chainReveal}>
        <section className={styles.chainPanel} aria-label="Anchor a payload">
          <div className={styles.chainPanelHead}>
            <div>
              <span className={styles.eyebrow}>↗ Anchor</span>
              <h2>Commit a payload</h2>
            </div>
            <span className={styles.chainPanelHint}>permissionless · rate limited</span>
          </div>
          <textarea className={styles.chainTextarea} rows={2} value={payload} onChange={(event) => setPayload(event.target.value)} placeholder="Anything worth proving existed…" />
          <input className={styles.chainInput} value={label} onChange={(event) => setLabel(event.target.value)} maxLength={64} placeholder="Optional public label (≤64 chars)" />
          <div className={styles.chainActions}>
            <button type="button" className={styles.chainButtonPrimary} disabled={busy || !payload.trim() || anchorRemaining > 0} onClick={() => void submit()}>
              <Layers size={12} aria-hidden="true" /> {anchorRemaining > 0 ? `Retry in ${anchorRemaining}s` : "Anchor it"}
            </button>
            {anchorRemaining > 0 ? <span className={styles.chainActionsHint} data-tone="warn">Paced — you can submit again once the cooldown clears.</span> : null}
          </div>
          {submitError ? (
            <div className={styles.chainReceipt} data-verdict="error">
              <div className={styles.chainVerdict}>
                <span className={styles.chainVerdictBadge}>Not submitted</span>
                <span className={styles.chainVerdictNote}>{submitError}</span>
              </div>
            </div>
          ) : null}
          {pendingCommits.length > 0 ? (
            <div className={styles.chainCommits}>
              {pendingCommits.map((commit) => (
                <div key={commit.anchorId} className={styles.chainCommitCard} data-status={commit.status}>
                  <div className={styles.chainCommitHead}>
                    <span className={styles.chainVerdictBadge}>
                      {commit.status === "anchored" ? <><BadgeCheck size={11} aria-hidden="true" /> Sealed</> : <><span className={styles.chainPulseDot} aria-hidden="true" /> Sealing</>}
                    </span>
                    <span className={styles.chainCommitAt}>{formatUtc(commit.at)}</span>
                  </div>
                  {commit.label ? <span className={styles.chainCommitLabel}>“{commit.label}”</span> : null}
                  <p className={styles.chainCommitPayload} title={commit.payload}>{commit.payload}</p>
                  <div className={styles.chainCommitRows}>
                    <Row label="Certificate" value={<Copyable value={commit.anchorId} text={shortHash(commit.anchorId, 12)} copyKey={`anchor-${commit.anchorId}`} onCopy={copy} copied={copied} />} />
                    <Row label="Subject hash" value={<Copyable value={commit.subjectHash} text={shortHash(commit.subjectHash, 16)} copyKey={`subject-${commit.anchorId}`} onCopy={copy} copied={copied} />} />
                    {commit.status === "anchored" && commit.blockId ? (
                      <Row label="Block" value={commit.blockId.replace("block_", "#")} />
                    ) : (
                      <Row label="Status" value="pending" />
                    )}
                  </div>
                  <p className={styles.chainReceiptFoot}>
                    <ArrowRight size={11} aria-hidden="true" /> Verify it above once the miner seals a block.
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </Reveal>

      <Reveal className={styles.chainReveal}>
        <section className={styles.chainSection} aria-label="Blocks">
          <div className={styles.thoughtSectionHeading}>
            <div>
              <span className={styles.eyebrow}>◈ Ledger</span>
              <h2>Blocks</h2>
            </div>
            <span>{info ? `${info.height} blocks` : "—"}</span>
          </div>
          {blocks === null ? (
            <p className={styles.chainEmpty}>The chain is not reachable right now.</p>
          ) : blocks.items.length === 0 ? (
            <p className={styles.chainEmpty}>No blocks yet — the miner mints a genesis block on the first tick.</p>
          ) : (
            <ul className={styles.chainLedger}>
              {blocks.items.map((block, index) => {
                const open = openBlock?.id === block.id;
                return (
                  <li key={block.id} id={`ledger-block-${block.id}`}>
                    <button type="button" className={styles.chainLedgerRow} onClick={() => void toggleBlock(block.id)} aria-expanded={open}>
                      <span className={styles.chainLedgerIndex}>#{block.index}</span>
                      <span className={styles.chainLedgerMain}>
                        <span className={styles.chainLedgerHash}><HashLine value={block.hash} /></span>
                        <span className={styles.chainLedgerMeta}>
                          <span>prev {shortHash(block.prevHash, 8)}</span>
                          <span>root {shortHash(block.certRoot, 8)}</span>
                          <span>nonce {block.nonce}</span>
                          <span>{block.proofMode === "proof" ? `${block.difficulty} zeros` : "sim"}</span>
                        </span>
                      </span>
                      <span className={styles.chainLedgerRight}>
                        <span className={styles.chainCountChip}>{block.anchorCount} {block.anchorCount === 1 ? "cert" : "certs"}</span>
                        <span className={styles.chainLedgerTime}>{formatUtc(block.timestamp)}</span>
                        <ChevronDown size={13} aria-hidden="true" className={styles.chainLedgerChevron} data-open={open} />
                      </span>
                      <span className={styles.chainLedgerSpine} aria-hidden="true" data-last={index === blocks.items.length - 1} />
                    </button>
                    {open ? (
                      <div className={styles.chainLedgerDetail}>
                        {openBlock.anchors.length === 0 ? (
                          <p className={styles.chainEmpty}>Genesis carries no certificates.</p>
                        ) : (
                          <ul className={styles.chainCertList}>
                            {openBlock.anchors.map((anchor) => (
                              <li key={anchor.id} className={styles.chainCertRow}>
                                <span className={styles.chainSourceChip}>
                                  <span className={styles.chainSourceDot} style={{ background: SOURCE_DOTS[anchor.source] }} aria-hidden="true" />
                                  {anchor.source}
                                </span>
                                <span className={styles.chainCertBody}>
                                  <span className={styles.chainCertSummary} title={anchor.summary}>{anchor.summary}</span>
                                  <code className={styles.chainMono}>{shortHash(anchor.subjectHash, 14)}</code>
                                </span>
                                <span className={styles.chainCertStatus} data-status={anchor.status}>{anchor.status}</span>
                                <span className={styles.chainCertSigned} title="Signed with the site key">
                                  {anchor.siteSignature ? <><BadgeCheck size={12} aria-hidden="true" /> signed</> : "unsigned"}
                                </span>
                                {anchor.target ? (
                                  <Link className={styles.chainCertLink} href={anchor.target.href} aria-label={anchor.target.label} title={anchor.target.label}>
                                    <ArrowRight size={13} aria-hidden="true" />
                                  </Link>
                                ) : (
                                  <span className={styles.chainCertLinkPlaceholder} aria-hidden="true" />
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className={styles.chainDetailFoot}>
                          <Hash size={10} aria-hidden="true" /> {openBlock.certIds.length} certificate{openBlock.certIds.length === 1 ? "" : "s"} merkle-sealed · replayed against the full chain on every check
                        </p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {blocks ? (
            <div className={styles.chainPagerWrap}>
              <Pagination page={page} totalPages={totalPages} onChange={changePage} label="Chain block pages" />
            </div>
          ) : null}
        </section>
      </Reveal>

      <Reveal className={styles.chainReveal}>
        <section className={styles.chainPanel} aria-label="How anchoring works">
          <div className={styles.chainPrimer}>
            <div className={styles.chainPrimerStep}>
              <span className={styles.chainPrimerIndex}>01</span>
              <span className={styles.chainPrimerTitle}>Commit</span>
              <p className={styles.chainPrimerBody}>Payloads are normalised and hashed with SHA-256, then the original is discarded.</p>
            </div>
            <div className={styles.chainPrimerStep}>
              <span className={styles.chainPrimerIndex}>02</span>
              <span className={styles.chainPrimerTitle}>Sign</span>
              <p className={styles.chainPrimerBody}>Each certificate carries the site ed25519 signature and key, verifiable offline.</p>
            </div>
            <div className={styles.chainPrimerStep}>
              <span className={styles.chainPrimerIndex}>03</span>
              <span className={styles.chainPrimerTitle}>Seal</span>
              <p className={styles.chainPrimerBody}>Buffered certificates are merkle-rooted into a block and chained by prev-hash.</p>
            </div>
          </div>
          <p className={styles.chainFootnote}>
            <Link2 size={12} aria-hidden="true" /> Verification replays the full chain on every check: block hashes, prev-hash
            linkage, merkle roots, and every certificate signature.
          </p>
        </section>
      </Reveal>
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className={styles.chainStat}>
      <span className={styles.chainStatLabel}>{icon} {label}</span>
      <span className={styles.chainStatValue}>{value}</span>
      <span className={styles.chainStatSub}>{sub}</span>
    </div>
  );
}

function Field({ label, value, wide = false }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? `${styles.chainField} ${styles.chainFieldWide}` : styles.chainField}>
      <span className={styles.chainFieldLabel}>{label}</span>
      <span className={styles.chainFieldValue}>{value}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.chainReceiptRow}>
      <span className={styles.chainReceiptKey}>{label}</span>
      <span className={styles.chainReceiptValue}>{value}</span>
    </div>
  );
}

function Copyable({ value, text, copyKey, onCopy, copied }: { value: string; text: string; copyKey: string; onCopy: (value: string, key: string) => Promise<void>; copied: string | null }) {
  return (
    <span className={styles.chainCopyable}>
      <code className={styles.chainMono}>{text}</code>
      <button type="button" className={styles.chainCopyButton} onClick={() => void onCopy(value, copyKey)} aria-label="Copy value">
        {copied === copyKey ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
      </button>
    </span>
  );
}

function HashLine({ value }: { value: string }) {
  const shown = value.length <= 24 ? value : `${value.slice(0, 16)}…${value.slice(-6)}`;
  const zeros = /^0+/.exec(shown)?.[0] ?? "";
  return (
    <span className={styles.chainMono}>
      {zeros ? <em className={styles.chainZeros}>{zeros}</em> : null}{shown.slice(zeros.length)}
    </span>
  );
}

function VerifyReceipt({ result, onCopy, copied, onOpenBlock }: { result: VerifyResult; onCopy: (value: string, key: string) => Promise<void>; copied: string | null; onOpenBlock: (id: string) => void }) {
  if (result.error) {
    return (
      <div className={styles.chainReceipt} data-verdict="error">
        <div className={styles.chainVerdict}>
          <span className={styles.chainVerdictBadge}>Lookup failed</span>
          <span className={styles.chainVerdictNote}>{result.error}</span>
        </div>
      </div>
    );
  }
  const response = result.response;
  if (!response) return null;
  const verdict = response.found && response.signatureValid && response.chainIntegrity ? "verified" : response.found ? "mismatch" : "not-found";
  const blockIndex = response.block ? parseBlockIndex(response.block.id) : response.anchor?.blockId ? parseBlockIndex(response.anchor.blockId) : null;
  return (
    <div className={styles.chainReceipt} data-verdict={verdict}>
      <div className={styles.chainVerdict}>
        <span className={styles.chainVerdictBadge}>
          {verdict === "verified" ? <><ShieldCheck size={12} aria-hidden="true" /> Verified on chain</> : verdict === "mismatch" ? "Found · checks failed" : "No such commitment"}
        </span>
        <span className={styles.chainVerdictNote}>
          {verdict === "verified" ? "Commitment exists, signature checks out, chain intact." : verdict === "mismatch" ? "The commitment is on chain but a check did not pass." : "No certificate matches this input."}
        </span>
      </div>
      <div className={styles.chainCheckRow}>
        <span data-ok={response.signatureValid}>
          {response.signatureValid ? <BadgeCheck size={11} aria-hidden="true" /> : <ChevronDown size={11} aria-hidden="true" />}
          signature {response.signatureValid ? "valid" : "invalid"}
        </span>
        <span data-ok={response.chainIntegrity}>
          {response.chainIntegrity ? <ShieldCheck size={11} aria-hidden="true" /> : <ChevronDown size={11} aria-hidden="true" />}
          chain {response.chainIntegrity ? "intact" : "tampered"}
        </span>
        <span>{result.mode === "payload" ? "hashed by Core" : result.mode === "hash" ? "hash lookup" : "slug lookup"}</span>
      </div>
      {verdict === "verified" && response.context ? (
        <div className={styles.chainContext}>
          <span className={styles.chainContextTitle}><Link2 size={11} aria-hidden="true" /> Chain position</span>
          <div className={styles.chainContextChain}>
            {response.context.prev ? <ChainBlockChip block={response.context.prev} label="prev" isCurrent={false} onOpen={onOpenBlock} /> : <span className={styles.chainContextGap}>genesis</span>}
            <span className={styles.chainContextArrow} aria-hidden="true">→</span>
            <ChainBlockChip block={response.context.current} label="this cert" isCurrent onOpen={onOpenBlock} />
            <span className={styles.chainContextArrow} aria-hidden="true">→</span>
            {response.context.next ? <ChainBlockChip block={response.context.next} label="next" isCurrent={false} onOpen={onOpenBlock} /> : <span className={styles.chainContextGap}>tip</span>}
          </div>
        </div>
      ) : null}
      {response.anchor ? (
        <div className={styles.chainReceiptRows}>
          <Row label="Subject hash" value={<Copyable value={response.anchor.subjectHash} text={shortHash(response.anchor.subjectHash, 16)} copyKey="verify-subject" onCopy={onCopy} copied={copied} />} />
          <Row label="Summary" value={response.anchor.summary} />
          <Row label="Source" value={`${response.anchor.source}${response.anchor.label ? ` · “${response.anchor.label}”` : ""}`} />
          <Row label="Block" value={blockIndex === null ? "pending" : `#${blockIndex}`} />
          <Row label="Committed" value={formatUtc(response.anchor.createdAt)} />
          <Row label="Certificate" value={<span className={styles.chainMono}>{shortHash(response.anchor.id, 12)}</span>} />
        </div>
      ) : null}
    </div>
  );
}

function ChainBlockChip({ block, label, isCurrent, onOpen }: { block: ChainBlockSummary | null; label: string; isCurrent: boolean; onOpen: (id: string) => void }) {
  if (!block) return <span className={styles.chainContextGap}>{label}</span>;
  return (
    <div className={styles.chainContextBlock} data-block-index={block.index} data-current={isCurrent}>
      <span className={styles.chainContextBlockLabel}>{label}</span>
      <span className={styles.chainSpineCube}>{block.index}</span>
      <span className={styles.chainSpineMeta}>{shortHash(block.hash, 6)}</span>
      <span className={styles.chainSpineMeta}>{block.anchorCount}×</span>
      <button type="button" className={styles.chainContextJump} data-jump-block={block.id} onClick={() => onOpen(block.id)} title={`Open block #${block.index} in the ledger`}>
        <ArrowRight size={11} aria-hidden="true" /> Ledger
      </button>
    </div>
  );
}

// VerifyProcessGraph renders the proof path as a live step flow: each step
// lights up in order once the verify response arrives (Core replays the whole
// chain per request), and clicking a step expands its full computation —
// inputs, per-level intermediate values, and the recomputed-vs-stored verdict.
function VerifyProcessGraph({ steps, merkle, context, running, verdict }: { steps: VerifyStep[] | null; merkle: VerifyMerkleProof | null; context: VerifyChainContext | null; running: boolean; verdict: "verified" | "mismatch" | "idle" }) {
  const [visible, setVisible] = useState(0);
  const [openStep, setOpenStep] = useState<string | null>(null);
  useEffect(() => {
    const reset = window.setTimeout(() => setVisible(0), 0);
    if (!steps || steps.length === 0) return () => window.clearTimeout(reset);
    const timer = window.setInterval(() => {
      setVisible((current) => {
        if (current >= steps.length) {
          window.clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, 240);
    return () => { window.clearTimeout(reset); window.clearInterval(timer); };
  }, [steps]);

  return (
    <div className={styles.chainGraphPanel} data-verdict={verdict}>
      <div className={styles.chainGraphHead}>
        <span className={styles.eyebrow}>⌁ Proof path</span>
        <span className={styles.chainGraphHint}>{running ? "verifying…" : steps && steps.length > 0 ? `${visible}/${steps.length} steps traced` : "click a step for the full computation"}</span>
      </div>
      {!steps || steps.length === 0 ? (
        <p className={styles.chainGraphEmpty}>Run a verification to trace how Core proves this commitment — certificate lookup → site signature → merkle root → block hash → full-chain replay.</p>
      ) : (
        <ol className={styles.chainGraph}>
          {steps.map((step, index) => {
            const revealed = index < visible;
            const open = openStep === step.id;
            return (
              <li key={step.id} className={styles.chainGraphStep} data-step-id={step.id} data-state={revealed ? step.status : "pending"} data-lit={revealed && index + 1 < visible}>
                <button type="button" className={styles.chainGraphNode} tabIndex={0} aria-expanded={open} onClick={() => setOpenStep(open ? null : step.id)}>
                  <span className={styles.chainGraphBadge}>
                    {!revealed ? <Clock size={11} aria-hidden="true" /> : step.status === "passed" ? <BadgeCheck size={11} aria-hidden="true" /> : <ChevronDown size={11} aria-hidden="true" />}
                  </span>
                  <span className={styles.chainGraphLabel}>{step.label}</span>
                  <span className={styles.chainGraphState}>{revealed ? step.status : "pending"}</span>
                  <ChevronDown size={11} aria-hidden="true" className={styles.chainGraphChevron} />
                </button>
                {index < steps.length - 1 ? <span className={styles.chainGraphLink} aria-hidden="true" /> : null}
                {revealed && open ? (
                  <div className={styles.chainGraphDetail} data-step-detail>
                    <div className={styles.chainGraphDetailHead}>
                      <span className={styles.chainGraphDetailMark} data-ok={step.status === "passed"}>
                        {step.status === "passed" ? <BadgeCheck size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
                      </span>
                      <span className={styles.chainGraphDetailTitle}>{step.label}</span>
                      <span className={styles.chainGraphDetailStatus}>{step.status}</span>
                    </div>
                    {step.detail ? (
                      <p className={styles.chainGraphDetailLead} data-step-detail-lead>{step.detail}</p>
                    ) : null}
                    {step.inputs && step.inputs.length > 0 ? (
                      step.id === "block-hash" ? (
                        <div className={styles.chainGraphPreimage} data-preimage>
                          {step.inputs.map((input, inputIndex) => (
                            <span key={input.name} className={styles.chainGraphPreimageSeg}>
                              {inputIndex > 0 ? <b className={styles.chainGraphPreimagePipe} aria-hidden="true">|</b> : null}
                              <code title={input.name}>{input.value}</code>
                            </span>
                          ))}
                          <span className={styles.chainGraphPreimageArrow} data-preimage-arrow aria-hidden="true">→ sha256</span>
                        </div>
                      ) : (
                        <dl className={styles.chainGraphInputs} data-step-inputs>
                          {step.inputs.map((input) => (
                            <div key={input.name} className={styles.chainGraphInputRow}>
                              <dt>{input.name}</dt>
                              <dd><code>{input.value}</code></dd>
                            </div>
                          ))}
                        </dl>
                      )
                    ) : null}
                    {step.computations && step.computations.length > 0 ? (
                      <ol className={styles.chainGraphComps} data-step-comps>
                        {step.computations.map((computation, computationIndex) => (
                          <li key={computationIndex} className={styles.chainGraphCompRow}>
                            <span className={styles.chainGraphCompLevel}>L{computationIndex + 1}</span>
                            <code className={styles.chainGraphCompExpr}>{computation.expression}</code>
                            <span className={styles.chainGraphCompEq} aria-hidden="true">=</span>
                            <code className={styles.chainGraphCompVal}>{computation.value}</code>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    {step.id === "block-hash" && context?.current && step.computations && step.computations.length > 0 ? (
                      <div className={styles.chainGraphCompare} data-compare>
                        <div className={styles.chainGraphCompareRow}>
                          <span>recomputed</span>
                          <code>{step.computations[0].value}</code>
                        </div>
                        <div className={styles.chainGraphCompareRow}>
                          <span>stored</span>
                          <code>{context.current.hash}</code>
                        </div>
                        <div className={styles.chainGraphCompareRow}>
                          <span>match</span>
                          <code data-ok={step.computations[0].value === context.current.hash}>
                            {step.computations[0].value === context.current.hash ? "=== ✓" : "!= ✗"}
                          </code>
                        </div>
                      </div>
                    ) : null}
                    {step.id === "merkle" && merkle ? (
                      <div className={styles.chainGraphMerkle} data-merkle-path>
                        <div className={styles.chainGraphCompareRow}>
                          <span>leaf[{merkle.leafIndex}]</span>
                          <code>{merkle.leaf}</code>
                        </div>
                        {merkle.siblings.map((sibling, siblingIndex) => (
                          <div key={siblingIndex} className={styles.chainGraphCompareRow}>
                            <span>sibling[{sibling.position}]</span>
                            <code>{sibling.value}</code>
                          </div>
                        ))}
                        <div className={styles.chainGraphCompareRow}>
                          <span>root</span>
                          <code data-ok={merkle.matches}>{merkle.root}</code>
                        </div>
                      </div>
                    ) : null}
                    {step.output ? (
                      <div className={styles.chainGraphVerdict} data-step-verdict data-ok={step.status === "passed"}>
                        {step.output}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// Core answers throttled public writes with 429 RATE_LIMITED; the SDK exposes
// it as a typed ApiError so the explorer can hold the button instead of failing.
function describeFailure(error: unknown): { rateLimited: boolean; message: string } {
  if (error instanceof ApiError && (error.status === 429 || error.code === "RATE_LIMITED")) {
    return { rateLimited: true, message: "Rate limit reached — the chain is pacing your requests. Wait a moment and try again." };
  }
  if (error instanceof Error && error.message) {
    return { rateLimited: false, message: error.message };
  }
  return { rateLimited: false, message: "The request could not be completed." };
}

function parseBlockIndex(id: string): number | null {
  const match = /^block_(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

function remainingSeconds(until: number, now: number): number {
  if (until <= now) return 0;
  return Math.max(1, Math.ceil((until - now) / 1000));
}

function formatUtc(value: string): string {
  return value.replace("T", " ").replace("Z", " UTC");
}

function shortHash(value: string, head = 10): string {
  if (!value) return "—";
  return value.length <= head + 7 ? value : `${value.slice(0, head)}…${value.slice(-6)}`;
}
