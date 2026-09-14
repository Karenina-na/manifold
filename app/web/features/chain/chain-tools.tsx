"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ArrowRight, BadgeCheck, Check, ChevronDown, Clock, Copy, Layers, Link2, ScanLine, ShieldCheck } from "lucide-react";
import type { VerifyChainContext, VerifyMerkleProof, VerifyResponse, VerifyStep } from "@manifold/contracts";
import { ApiError } from "@manifold/sdk";
import { createBrowserClient } from "../../lib/api";
import { usePendingCommits, type PendingCommit } from "./use-pending-commits";
import { explorerHref, readToolsState, toolsHref, type VerifyMode } from "./chain-url";
import styles from "../../app/site.module.css";

type VerifyResult = {
  mode: VerifyMode;
  input: string;
  response: VerifyResponse | null;
  error: string | null;
};

const VERIFY_MODE_IDS: VerifyMode[] = ["payload", "hash", "content", "comment"];
const VERIFY_COOLDOWN_MS = 4_000;
const ANCHOR_COOLDOWN_MS = 10_000;
const RATE_LIMIT_COOLDOWN_MS = 30_000;

export function ChainTools() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const router = useRouter();
  const state = useMemo(() => readToolsState(new URLSearchParams(searchParams.toString())), [searchParams]);
  const selectTab = (tab: "verify" | "submit") => router.replace(toolsHref(tab), { scroll: false });

  return (
    <div className={styles.chainBody}>
      <section className={styles.chainPanel} aria-label={t("chain.toolsLabel")}>
        <div className={styles.chainWorkspaceTabs} role="tablist" aria-label={t("chain.toolsTabs")}>
          <button type="button" role="tab" aria-selected={state.tab === "verify"} className={state.tab === "verify" ? `${styles.chainWorkspaceTab} ${styles.chainWorkspaceTabActive}` : styles.chainWorkspaceTab} onClick={() => selectTab("verify")}><ScanLine size={13} aria-hidden="true" /> {t("chain.verifyTab")}</button>
          <button type="button" role="tab" aria-selected={state.tab === "submit"} className={state.tab === "submit" ? `${styles.chainWorkspaceTab} ${styles.chainWorkspaceTabActive}` : styles.chainWorkspaceTab} onClick={() => selectTab("submit")}><Layers size={13} aria-hidden="true" /> {t("chain.submitTab")}</button>
        </div>
        {state.tab === "verify" ? <VerifyTool key={`${state.mode}|${state.value}`} initialMode={state.mode} initialValue={state.value} onOpenBlock={(id) => router.push(explorerHref({ tab: "blocks", blockId: id }), { scroll: false })} /> : <SubmitTool key="submit" />}
      </section>
    </div>
  );
}

function VerifyTool({ initialMode, initialValue, onOpenBlock }: { initialMode: VerifyMode; initialValue: string; onOpenBlock: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const client = useMemo(() => createBrowserClient(), []);
  const [mode, setMode] = useState<VerifyMode>(initialMode);
  const [verifyInput, setVerifyInput] = useState(initialValue);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyUntil, setVerifyUntil] = useState(0);
  const [now, setNow] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const verifyModes = VERIFY_MODE_IDS.map((id) => ({
    id,
    label: id === "payload" ? t("chain.payload") : id === "hash" ? "SHA-256" : id === "content" ? t("chain.slug") : t("chain.commentId"),
    placeholder: id === "payload" ? t("chain.payloadPlaceholder") : id === "hash" ? t("chain.hashPlaceholder") : id === "content" ? t("chain.slugPlaceholder") : t("chain.commentIdPlaceholder"),
  }));

  useEffect(() => {
    if (verifyUntil <= Date.now()) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= verifyUntil) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [verifyUntil]);

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1600);
    } catch {
      setCopied(null);
    }
  };

  const runVerify = async () => {
    const input = verifyInput.trim();
    if (!input || Date.now() < verifyUntil) return;
    setBusy(true);
    setVerify({ mode, input, response: null, error: null });
    try {
      const response = mode === "payload"
        ? await client.verifyPayload(verifyInput)
        : mode === "hash"
          ? await client.verifyByHash(input)
          : mode === "content"
            ? await client.verifyContent(input)
            : await client.verifyComment(input);
      setVerify({ mode, input, response, error: null });
      setVerifyUntil(Date.now() + VERIFY_COOLDOWN_MS);
    } catch (error) {
      const outcome = describeFailure(error, t);
      setVerify({ mode, input, response: null, error: outcome.message });
      setVerifyUntil(Date.now() + (outcome.rateLimited ? RATE_LIMIT_COOLDOWN_MS : VERIFY_COOLDOWN_MS));
    } finally {
      setBusy(false);
    }
  };

  const verifyReady = mode === "hash" ? /^[a-f0-9]{64}$/i.test(verifyInput.trim()) : verifyInput.trim().length > 0;
  const verifyRemaining = remainingSeconds(verifyUntil, now);
  return (
    <div className={styles.chainVerifyGrid}>
      <div className={styles.chainVerifyLeft}>
        <div className={styles.chainToolIntro}><span className={styles.eyebrow}>✦ Verify</span><p>{t("chain.verifyIntro")}</p></div>
        <div className={styles.chainSegmented} role="tablist" aria-label={t("chain.verificationMode")}>
          {verifyModes.map((item) => <button key={item.id} type="button" role="tab" aria-selected={mode === item.id} className={mode === item.id ? `${styles.chainSegment} ${styles.chainSegmentActive}` : styles.chainSegment} onClick={() => { setMode(item.id); setVerifyInput(""); setVerify(null); }}>{item.label}</button>)}
        </div>
        {mode === "payload" ? <textarea className={styles.chainTextarea} rows={4} value={verifyInput} onChange={(event) => setVerifyInput(event.target.value)} placeholder={verifyModes[0].placeholder} aria-label={verifyModes[0].label} /> : <input className={styles.chainInput} value={verifyInput} onChange={(event) => setVerifyInput(event.target.value)} placeholder={verifyModes.find((item) => item.id === mode)?.placeholder} aria-label={verifyModes.find((item) => item.id === mode)?.label} />}
        <div className={styles.chainActions}><button type="button" className={styles.chainButtonPrimary} disabled={busy || !verifyReady || verifyRemaining > 0} onClick={() => void runVerify()}><ScanLine size={12} aria-hidden="true" /> {verifyRemaining > 0 ? t("chain.retry", { seconds: verifyRemaining }) : t("chain.runVerification")}</button>{verifyRemaining > 0 ? <span className={styles.chainActionsHint} data-tone="warn">{t("chain.verifyPaced")}</span> : null}</div>
        {verify ? <VerifyReceipt result={verify} onCopy={copy} copied={copied} onOpenBlock={onOpenBlock} locale={locale} /> : null}
      </div>
      <div className={styles.chainVerifyRight}><VerifyProcessGraph steps={verify?.response?.steps ?? null} merkle={verify?.response?.merkle ?? null} context={verify?.response?.context ?? null} running={busy} verdict={verify?.response?.found && verify.response.signatureValid && verify.response.chainIntegrity ? "verified" : verify?.response?.found ? "mismatch" : "idle"} /></div>
    </div>
  );
}

function SubmitTool() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const client = useMemo(() => createBrowserClient(), []);
  const { pendingCommits, addPendingCommit } = usePendingCommits(client);
  const [payload, setPayload] = useState("");
  const [label, setLabel] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [anchorUntil, setAnchorUntil] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (anchorUntil <= Date.now()) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= anchorUntil) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [anchorUntil]);

  const submit = async () => {
    if (!payload.trim() || Date.now() < anchorUntil) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const result = await client.submitAnchor({ payload, label: label.trim() });
      const commit: PendingCommit = { anchorId: result.anchorId, subjectHash: result.subjectHash, label: label.trim(), payload, at: new Date().toISOString(), status: "pending", blockId: null };
      addPendingCommit(commit);
      setPayload("");
      setLabel("");
      setAnchorUntil(Date.now() + ANCHOR_COOLDOWN_MS);
    } catch (error) {
      const outcome = describeFailure(error, t);
      setSubmitError(outcome.message);
      setAnchorUntil(Date.now() + (outcome.rateLimited ? RATE_LIMIT_COOLDOWN_MS : ANCHOR_COOLDOWN_MS));
    } finally {
      setBusy(false);
    }
  };

  const anchorRemaining = remainingSeconds(anchorUntil, now);
  return (
    <div className={styles.chainSubmitTool}>
      <div className={styles.chainToolIntro}><span className={styles.eyebrow}>↗ Anchor</span><p>{t("chain.submitIntro")}</p></div>
      <textarea className={styles.chainTextarea} rows={4} value={payload} onChange={(event) => setPayload(event.target.value)} placeholder={t("chain.payloadSubmitPlaceholder")} aria-label={t("chain.payload")} />
      <input className={styles.chainInput} value={label} onChange={(event) => setLabel(event.target.value)} maxLength={64} placeholder={t("chain.publicLabelPlaceholder")} aria-label={t("chain.label")} />
      <div className={styles.chainActions}><button type="button" className={styles.chainButtonPrimary} disabled={busy || !payload.trim() || anchorRemaining > 0} onClick={() => void submit()}><Layers size={12} aria-hidden="true" /> {anchorRemaining > 0 ? t("chain.retry", { seconds: anchorRemaining }) : t("chain.anchorIt")}</button>{anchorRemaining > 0 ? <span className={styles.chainActionsHint} data-tone="warn">{t("chain.anchorPaced")}</span> : null}</div>
      {submitError ? <div className={styles.chainReceipt} data-verdict="error"><div className={styles.chainVerdict}><span className={styles.chainVerdictBadge}>{t("chain.notSubmitted")}</span><span className={styles.chainVerdictNote}>{submitError}</span></div></div> : null}
      {pendingCommits.length > 0 ? <div className={styles.chainCommits}>{pendingCommits.map((commit) => <div key={commit.anchorId} className={styles.chainCommitCard} data-status={commit.status}><div className={styles.chainCommitHead}><span className={styles.chainVerdictBadge}>{commit.status === "anchored" ? <><BadgeCheck size={11} aria-hidden="true" /> {t("chain.sealed")}</> : <><span className={styles.chainPulseDot} aria-hidden="true" /> {t("chain.sealing")}</>}</span><span className={styles.chainCommitAt}>{formatUtc(commit.at, locale)}</span></div>{commit.label ? <span className={styles.chainCommitLabel}>“{commit.label}”</span> : null}<p className={styles.chainCommitPayload} title={commit.payload}>{commit.payload}</p><div className={styles.chainCommitRows}><Row label={t("chain.certificate")} value={<span className={styles.chainMono}>{shortHash(commit.anchorId, 16)}</span>} /><Row label={t("chain.subjectHash")} value={<span className={styles.chainMono}>{shortHash(commit.subjectHash, 18)}</span>} />{commit.status === "anchored" && commit.blockId ? <Row label={t("chain.block")} value={commit.blockId.replace("block_", "#")} /> : <Row label={t("chain.status")} value={t("chain.pending")} />}</div><p className={styles.chainReceiptFoot}><ArrowRight size={11} aria-hidden="true" /> {t("chain.verifyAfterSeal")}</p></div>)}</div> : null}
    </div>
  );
}

function VerifyReceipt({ result, onCopy, copied, onOpenBlock, locale }: { result: VerifyResult; onCopy: (value: string, key: string) => Promise<void>; copied: string | null; onOpenBlock: (id: string) => void; locale: string }) {
  const { t } = useTranslation();
  if (result.error) return <div className={styles.chainReceipt} data-verdict="error"><div className={styles.chainVerdict}><span className={styles.chainVerdictBadge}>{t("chain.lookupFailed")}</span><span className={styles.chainVerdictNote}>{result.error}</span></div></div>;
  const response = result.response;
  if (!response) return null;
  const verdict = response.found && response.signatureValid && response.chainIntegrity ? "verified" : response.found ? "mismatch" : "not-found";
  const blockIndex = response.block ? parseBlockIndex(response.block.id) : response.anchor?.blockId ? parseBlockIndex(response.anchor.blockId) : null;
  const modeLabel = result.mode === "payload" ? t("chain.hashedByCore") : result.mode === "hash" ? t("chain.hashLookup") : result.mode === "content" ? t("chain.slugLookup") : t("chain.commentLookup");
  return <div className={styles.chainReceipt} data-verdict={verdict}><div className={styles.chainVerdict}><span className={styles.chainVerdictBadge}>{verdict === "verified" ? <><ShieldCheck size={12} aria-hidden="true" /> {t("chain.verified")}</> : verdict === "mismatch" ? t("chain.mismatch") : t("chain.notFound")}</span><span className={styles.chainVerdictNote}>{verdict === "verified" ? t("chain.verifiedNote") : verdict === "mismatch" ? t("chain.mismatchNote") : t("chain.notFoundNote")}</span></div><div className={styles.chainCheckRow}><span data-ok={response.signatureValid}>{response.signatureValid ? <BadgeCheck size={11} aria-hidden="true" /> : <ChevronDown size={11} aria-hidden="true" />}{response.signatureValid ? t("chain.signatureValid") : t("chain.signatureInvalid")}</span><span data-ok={response.chainIntegrity}>{response.chainIntegrity ? <ShieldCheck size={11} aria-hidden="true" /> : <ChevronDown size={11} aria-hidden="true" />}{response.chainIntegrity ? t("chain.chainIntact") : t("chain.chainTampered")}</span><span>{modeLabel}</span></div>{verdict === "verified" && response.context ? <div className={styles.chainContext}><span className={styles.chainContextTitle}><Link2 size={11} aria-hidden="true" /> {t("chain.position")}</span><div className={styles.chainContextChain}>{response.context.prev ? <ChainBlockChip block={response.context.prev} label={t("chain.prev")} isCurrent={false} onOpen={onOpenBlock} /> : <span className={styles.chainContextGap}>{t("chain.genesis")}</span>}<span className={styles.chainContextArrow} aria-hidden="true">→</span><ChainBlockChip block={response.context.current} label={t("chain.thisCert")} isCurrent onOpen={onOpenBlock} /><span className={styles.chainContextArrow} aria-hidden="true">→</span>{response.context.next ? <ChainBlockChip block={response.context.next} label={t("chain.next")} isCurrent={false} onOpen={onOpenBlock} /> : <span className={styles.chainContextGap}>{t("chain.tip")}</span>}</div></div> : null}{response.anchor ? <div className={styles.chainReceiptRows}><Row label={t("chain.subjectHash")} value={<Copyable value={response.anchor.subjectHash} text={shortHash(response.anchor.subjectHash, 16)} copyKey="verify-subject" onCopy={onCopy} copied={copied} />} /><Row label={t("chain.summary")} value={response.anchor.summary} /><Row label={t("chain.source")} value={`${response.anchor.source}${response.anchor.label ? ` · “${response.anchor.label}”` : ""}`} /><Row label={t("chain.block")} value={blockIndex === null ? t("chain.pending") : `#${blockIndex}`} /><Row label={t("chain.committed")} value={formatUtc(response.anchor.createdAt, locale)} /><Row label={t("chain.certificate")} value={<span className={styles.chainMono}>{shortHash(response.anchor.id, 12)}</span>} /></div> : null}</div>;
}

function ChainBlockChip({ block, label, isCurrent, onOpen }: { block: VerifyChainContext["current"]; label: string; isCurrent: boolean; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  if (!block) return <span className={styles.chainContextGap}>{label}</span>;
  return <div className={styles.chainContextBlock} data-block-index={block.index} data-current={isCurrent}><span className={styles.chainContextBlockLabel}>{label}</span><span className={styles.chainSpineCube}>{block.index}</span><span className={styles.chainSpineMeta}>{shortHash(block.hash, 6)}</span><span className={styles.chainSpineMeta}>{block.anchorCount}×</span><button type="button" className={styles.chainContextJump} onClick={() => onOpen(block.id)} title={t("chain.openExplorerBlock", { index: block.index })}><ArrowRight size={11} aria-hidden="true" /> {t("chain.ledgerOpen")}</button></div>;
}

function VerifyProcessGraph({ steps, merkle, context, running, verdict }: { steps: VerifyStep[] | null; merkle: VerifyMerkleProof | null; context: VerifyChainContext | null; running: boolean; verdict: "verified" | "mismatch" | "idle" }) {
  const { t } = useTranslation();
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

  return <div className={styles.chainGraphPanel} data-verdict={verdict}><div className={styles.chainGraphHead}><span className={styles.eyebrow}>⌁ Proof path</span><span className={styles.chainGraphHint}>{running ? t("chain.verifying") : steps && steps.length > 0 ? t("chain.stepsTraced", { visible, total: steps.length }) : t("chain.clickStep")}</span></div>{!steps || steps.length === 0 ? <p className={styles.chainGraphEmpty}>{t("chain.graphEmpty")}</p> : <ol className={styles.chainGraph}>{steps.map((step, index) => { const revealed = index < visible; const open = openStep === step.id; const label = stepLabel(step, t); const status = revealed ? stepStatus(step.status, t) : t("chain.statusPending"); return <li key={step.id} className={styles.chainGraphStep} data-step-id={step.id} data-state={revealed ? step.status : "pending"} data-lit={revealed && index + 1 < visible}><button type="button" className={styles.chainGraphNode} tabIndex={0} aria-expanded={open} onClick={() => setOpenStep(open ? null : step.id)}><span className={styles.chainGraphBadge}>{!revealed ? <Clock size={11} aria-hidden="true" /> : step.status === "passed" ? <BadgeCheck size={11} aria-hidden="true" /> : <ChevronDown size={11} aria-hidden="true" />}</span><span className={styles.chainGraphLabel}>{label}</span><span className={styles.chainGraphState}>{status}</span><ChevronDown size={11} aria-hidden="true" className={styles.chainGraphChevron} /></button>{index < steps.length - 1 ? <span className={styles.chainGraphLink} aria-hidden="true" /> : null}{revealed && open ? <div className={styles.chainGraphDetail} data-step-detail><div className={styles.chainGraphDetailHead}><span className={styles.chainGraphDetailMark} data-ok={step.status === "passed"}>{step.status === "passed" ? <BadgeCheck size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}</span><span className={styles.chainGraphDetailTitle}>{label}</span><span className={styles.chainGraphDetailStatus}>{stepStatus(step.status, t)}</span></div>{step.detail ? <p className={styles.chainGraphDetailLead} data-step-detail-lead>{step.detail}</p> : null}{step.inputs && step.inputs.length > 0 ? step.id === "block-hash" ? <div className={styles.chainGraphPreimage} data-preimage>{step.inputs.map((input, inputIndex) => <span key={input.name} className={styles.chainGraphPreimageSeg}>{inputIndex > 0 ? <b className={styles.chainGraphPreimagePipe} aria-hidden="true">|</b> : null}<code title={input.name}>{input.value}</code></span>)}<span className={styles.chainGraphPreimageArrow} data-preimage-arrow aria-hidden="true">→ sha256</span></div> : <dl className={styles.chainGraphInputs} data-step-inputs>{step.inputs.map((input) => <div key={input.name} className={styles.chainGraphInputRow}><dt>{input.name}</dt><dd><code>{input.value}</code></dd></div>)}</dl> : null}{step.computations && step.computations.length > 0 ? <ol className={styles.chainGraphComps} data-step-comps>{step.computations.map((computation, computationIndex) => <li key={computationIndex} className={styles.chainGraphCompRow}><span className={styles.chainGraphCompLevel}>L{computationIndex + 1}</span><code className={styles.chainGraphCompExpr}>{computation.expression}</code><span className={styles.chainGraphCompEq} aria-hidden="true">=</span><code className={styles.chainGraphCompVal}>{computation.value}</code></li>)}</ol> : null}{step.id === "block-hash" && context?.current && step.computations && step.computations.length > 0 ? <div className={styles.chainGraphCompare} data-compare><div className={styles.chainGraphCompareRow}><span>{t("chain.recomputed")}</span><code>{step.computations[0].value}</code></div><div className={styles.chainGraphCompareRow}><span>{t("chain.stored")}</span><code>{context.current.hash}</code></div><div className={styles.chainGraphCompareRow}><span>{t("chain.match")}</span><code data-ok={step.computations[0].value === context.current.hash}>{step.computations[0].value === context.current.hash ? "=== ✓" : "!= ✗"}</code></div></div> : null}{step.id === "merkle" && merkle ? <div className={styles.chainGraphMerkle} data-merkle-path><div className={styles.chainGraphCompareRow}><span>leaf[{merkle.leafIndex}]</span><code>{merkle.leaf}</code></div>{merkle.siblings.map((sibling, siblingIndex) => <div key={siblingIndex} className={styles.chainGraphCompareRow}><span>sibling[{sibling.position}]</span><code>{sibling.value}</code></div>)}<div className={styles.chainGraphCompareRow}><span>{t("chain.root")}</span><code data-ok={merkle.matches}>{merkle.root}</code></div></div> : null}{step.output ? <div className={styles.chainGraphVerdict} data-step-verdict data-ok={step.status === "passed"}>{step.output}</div> : null}</div> : null}</li>; })}</ol>}</div>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className={styles.chainReceiptRow}><span className={styles.chainReceiptKey}>{label}</span><span className={styles.chainReceiptValue}>{value}</span></div>;
}

function Copyable({ value, text, copyKey, onCopy, copied }: { value: string; text: string; copyKey: string; onCopy: (value: string, key: string) => Promise<void>; copied: string | null }) {
  const { t } = useTranslation();
  return <span className={styles.chainCopyable}><code className={styles.chainMono}>{text}</code><button type="button" className={styles.chainCopyButton} onClick={() => void onCopy(value, copyKey)} aria-label={t("chain.copy")}>{copied === copyKey ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}</button></span>;
}

function describeFailure(error: unknown, t: TFunction): { rateLimited: boolean; message: string } {
  if (error instanceof ApiError && (error.status === 429 || error.code === "RATE_LIMITED")) return { rateLimited: true, message: t("chain.rateLimited") };
  if (error instanceof Error && error.message) return { rateLimited: false, message: error.message };
  return { rateLimited: false, message: t("chain.requestFailed") };
}

function parseBlockIndex(id: string): number | null {
  const match = /^block_(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

function remainingSeconds(until: number, now: number): number {
  if (until <= now) return 0;
  return Math.max(1, Math.ceil((until - now) / 1000));
}

function stepLabel(step: VerifyStep, t: TFunction): string {
  const key = step.id === "lookup" ? "chain.stepLookup" : step.id === "signature" ? "chain.stepSignature" : step.id === "merkle" ? "chain.stepMerkle" : step.id === "block-hash" ? "chain.stepBlockHash" : step.id === "chain" ? "chain.stepChain" : null;
  return key ? t(key) : step.label;
}

function stepStatus(status: VerifyStep["status"], t: TFunction): string {
  return t(status === "passed" ? "chain.statusPassed" : "chain.statusFailed");
}

function formatUtc(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(date)} UTC`;
}

function shortHash(value: string, head = 10): string {
  if (!value) return "—";
  return value.length <= head + 7 ? value : `${value.slice(0, head)}…${value.slice(-6)}`;
}
