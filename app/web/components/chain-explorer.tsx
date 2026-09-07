"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BadgeCheck, Boxes, Check, ChevronDown, Clock, Copy, Cpu, Fingerprint, Hash, KeyRound, Link2, Layers, ScanLine, ShieldCheck } from "lucide-react";
import type { AnchorSource, ChainBlockSummary, ChainInfo, SubmitAnchorResponse, VerifyResponse } from "@manifold/contracts";
import { createBrowserClient } from "../lib/api";
import { Pagination } from "./pagination";
import { Reveal } from "./reveal";
import styles from "../app/site.module.css";

type BlocksPage = { items: ChainBlockSummary[]; page: number; totalPages: number };
type VerifyMode = "payload" | "hash" | "content";
type BlockDetail = { id: string; certIds: string[]; anchors: Array<{ id: string; source: AnchorSource; label: string; subjectHash: string; status: string; siteSignature: string }> };

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
  const [blocks, setBlocks] = useState<BlocksPage | null>(initialBlocks);
  const [page, setPage] = useState(initialBlocks?.page ?? 1);
  const [openBlock, setOpenBlock] = useState<BlockDetail | null>(null);
  const [spineId, setSpineId] = useState<string | null>(initialBlocks?.items[0]?.id ?? null);
  const [mode, setMode] = useState<VerifyMode>("payload");
  const [verifyInput, setVerifyInput] = useState("");
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [payload, setPayload] = useState("");
  const [label, setLabel] = useState("");
  const [submitted, setSubmitted] = useState<SubmitAnchorResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyUntil, setVerifyUntil] = useState(0);
  const [anchorUntil, setAnchorUntil] = useState(0);
  const [now, setNow] = useState(0);

  const client = useMemo(() => createBrowserClient(), []);

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

  // Blocks arrive newest-first, so the spine reads genesis → tip left to right.
  const spine = useMemo(() => (blocks?.items ?? []).slice(0, 9).reverse(), [blocks]);
  const spineBlock = spine.find((block) => block.id === spineId) ?? spine[spine.length - 1] ?? null;
  const totalPages = blocks?.totalPages ?? 1;

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
      setOpenBlock({
        id,
        certIds: detail.certIds,
        anchors: detail.anchors.map((anchor) => ({ id: anchor.id, source: anchor.source, label: anchor.label, subjectHash: anchor.subjectHash, status: anchor.status, siteSignature: anchor.siteSignature })),
      });
    } catch {
      setOpenBlock(null);
    }
  };

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
    setSubmitted(null);
    setSubmitError(null);
    try {
      setSubmitted(await client.submitAnchor({ payload, label: label.trim() }));
      setPayload("");
      setLabel("");
      setAnchorUntil(Date.now() + ANCHOR_COOLDOWN_MS);
      const result = await client.chainBlocks({ page, pageSize: 20 });
      setBlocks({ items: result.data, page: result.pagination.page, totalPages: result.pagination.totalPages });
    } catch (error) {
      setSubmitted(null);
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
        <section className={styles.chainPanel} aria-label="Block spine">
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
              <div className={styles.chainSpine} role="tablist" aria-label="Recent blocks">
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
          {verify ? <VerifyReceipt result={verify} onCopy={copy} copied={copied} /> : null}
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
            {anchorRemaining > 0 ? <span className={styles.chainActionsHint} data-tone="warn">Paced — one commitment at a time.</span> : null}
          </div>
          {submitError ? (
            <div className={styles.chainReceipt} data-verdict="error">
              <div className={styles.chainVerdict}>
                <span className={styles.chainVerdictBadge}>Not submitted</span>
                <span className={styles.chainVerdictNote}>{submitError}</span>
              </div>
            </div>
          ) : null}
          {submitted ? (
            <div className={styles.chainReceipt} data-verdict="sealing">
              <div className={styles.chainVerdict}>
                <span className={styles.chainVerdictBadge}><span className={styles.chainPulseDot} aria-hidden="true" /> Sealing</span>
                <span className={styles.chainVerdictNote}>The miner mints a block within ~30s.</span>
              </div>
              <div className={styles.chainReceiptRows}>
                <Row label="Certificate" value={<Copyable value={submitted.anchorId} text={shortHash(submitted.anchorId, 12)} copyKey="anchor" onCopy={copy} copied={copied} />} />
                <Row label="Subject hash" value={<Copyable value={submitted.subjectHash} text={shortHash(submitted.subjectHash, 16)} copyKey="subject" onCopy={copy} copied={copied} />} />
                <Row label="Status" value={submitted.status} />
              </div>
              <p className={styles.chainReceiptFoot}>
                <ArrowRight size={11} aria-hidden="true" /> Verify it above once the miner seals a block.
              </p>
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
                  <li key={block.id}>
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
                                <code className={styles.chainMono}>{shortHash(anchor.subjectHash, 16)}</code>
                                <span className={styles.chainCertStatus} data-status={anchor.status}>{anchor.status}</span>
                                <span className={styles.chainCertSigned} title="Signed with the site key">
                                  {anchor.siteSignature ? <><BadgeCheck size={12} aria-hidden="true" /> signed</> : "unsigned"}
                                </span>
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
          {blocks && totalPages > 1 ? (
            <div className={styles.chainPagerWrap}>
              <Pagination page={page} totalPages={totalPages} onChange={setPage} label="Chain block pages" />
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

function VerifyReceipt({ result, onCopy, copied }: { result: VerifyResult; onCopy: (value: string, key: string) => Promise<void>; copied: string | null }) {
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
      {response.anchor ? (
        <div className={styles.chainReceiptRows}>
          <Row label="Subject hash" value={<Copyable value={response.anchor.subjectHash} text={shortHash(response.anchor.subjectHash, 16)} copyKey="verify-subject" onCopy={onCopy} copied={copied} />} />
          <Row label="Source" value={`${response.anchor.source}${response.anchor.label ? ` · “${response.anchor.label}”` : ""}`} />
          <Row label="Block" value={blockIndex === null ? "pending" : `#${blockIndex}`} />
          <Row label="Committed" value={formatUtc(response.anchor.createdAt)} />
          <Row label="Certificate" value={<span className={styles.chainMono}>{shortHash(response.anchor.id, 12)}</span>} />
        </div>
      ) : null}
    </div>
  );
}

// Core answers throttled public writes with 429 RATE_LIMITED; the SDK exposes
// it as an ApiError so the explorer can hold the button instead of failing.
function describeFailure(error: unknown): { rateLimited: boolean; message: string } {
  const failure = error as { status?: number; code?: string; message?: string } | null;
  if (failure?.status === 429 || failure?.code === "RATE_LIMITED") {
    return { rateLimited: true, message: "Rate limit reached — the chain is pacing your requests. Wait a moment and try again." };
  }
  return { rateLimited: false, message: failure?.message || "The request could not be completed." };
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
