"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, BadgeCheck, Boxes, Check, ChevronDown, Clock, Copy, Fingerprint, Hash, Link2, ShieldCheck } from "lucide-react";
import type { AnchorSource, ChainAnchor, ChainBlockDetail, ChainBlockSummary, ChainInfo } from "@manifold/contracts";
import { createBrowserClient } from "../../lib/api";
import { Pagination } from "../../components/ui/pagination";
import { Reveal } from "../../components/ui/reveal";
import { explorerHref, readExplorerState, toolsHref, type ExplorerState } from "./chain-url";
import styles from "../../app/site.module.css";

export type BlocksPage = { items: ChainBlockSummary[]; page: number; totalItems: number; totalPages: number };
export type AnchorsPage = { items: ChainAnchor[]; page: number; totalItems: number; totalPages: number; source: AnchorSource | null; ref: string | null };
type DetailState<T> = { id: string; data: T | null; error: boolean };

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

const ANCHOR_SOURCES: AnchorSource[] = ["content", "comment", "reaction", "profile", "site", "media", "auth", "visitor", "admin"];

export function ChainExplorer({ info, initialBlocks, initialAnchors = null }: { info: ChainInfo | null; initialBlocks: BlocksPage | null; initialAnchors?: AnchorsPage | null }) {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const router = useRouter();
  const client = useMemo(() => createBrowserClient(), []);
  const state = useMemo<ExplorerState>(() => readExplorerState(new URLSearchParams(searchParams.toString())), [searchParams]);
  const [blocks, setBlocks] = useState<BlocksPage | null>(initialBlocks);
  const [anchors, setAnchors] = useState<AnchorsPage | null>(initialAnchors);
  const [blockErrorKey, setBlockErrorKey] = useState<string | null>(null);
  const [anchorErrorKey, setAnchorErrorKey] = useState<string | null>(null);
  const [blockDetail, setBlockDetail] = useState<DetailState<ChainBlockDetail> | null>(null);
  const [anchorDetail, setAnchorDetail] = useState<DetailState<ChainAnchor> | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const blockKey = String(state.page);
  const anchorKey = `${state.page}|${state.source ?? ""}|${state.ref ?? ""}`;

  useEffect(() => {
    if (state.tab !== "blocks" || (blocks && blocks.page === state.page) || blockErrorKey === blockKey) return;
    let cancelled = false;
    void client.chainBlocks({ page: state.page, pageSize: 20 }).then((result) => {
      if (cancelled) return;
      setBlocks({ items: result.data, page: result.pagination.page, totalItems: result.pagination.totalItems, totalPages: result.pagination.totalPages });
      setBlockErrorKey(null);
    }).catch(() => {
      if (!cancelled) setBlockErrorKey(blockKey);
    });
    return () => { cancelled = true; };
  }, [blockErrorKey, blockKey, blocks, client, state.page, state.tab]);

  useEffect(() => {
    if (state.tab !== "anchors" || (anchors && anchors.page === state.page && anchors.source === state.source && anchors.ref === state.ref) || anchorErrorKey === anchorKey) return;
    let cancelled = false;
    void client.chainAnchors({ source: state.source ?? undefined, ref: state.ref ?? undefined, page: state.page, pageSize: 20 }).then((result) => {
      if (cancelled) return;
      setAnchors({ items: result.data, page: result.pagination.page, totalItems: result.pagination.totalItems, totalPages: result.pagination.totalPages, source: state.source, ref: state.ref });
      setAnchorErrorKey(null);
    }).catch(() => {
      if (!cancelled) setAnchorErrorKey(anchorKey);
    });
    return () => { cancelled = true; };
  }, [anchorErrorKey, anchorKey, anchors, client, state.page, state.ref, state.source, state.tab]);

  useEffect(() => {
    if (state.tab !== "blocks" || !state.blockId) {
      return;
    }
    if (blockDetail?.id === state.blockId) return;
    const id = state.blockId;
    let cancelled = false;
    void client.chainBlock(id).then((data) => {
      if (!cancelled) setBlockDetail({ id, data, error: false });
    }).catch(() => {
      if (!cancelled) setBlockDetail({ id, data: null, error: true });
    });
    return () => { cancelled = true; };
  }, [blockDetail, client, state.blockId, state.tab]);

  useEffect(() => {
    if (state.tab !== "anchors" || !state.anchorId) {
      return;
    }
    if (anchorDetail?.id === state.anchorId) return;
    const id = state.anchorId;
    let cancelled = false;
    void client.chainAnchor(id).then((data) => {
      if (!cancelled) setAnchorDetail({ id, data, error: false });
    }).catch(() => {
      if (!cancelled) setAnchorDetail({ id, data: null, error: true });
    });
    return () => { cancelled = true; };
  }, [anchorDetail, client, state.anchorId, state.tab]);

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1600);
    } catch {
      setCopied(null);
    }
  };

  const changeTab = (tab: "blocks" | "anchors") => {
    router.replace(explorerHref({ tab, page: 1 }), { scroll: false });
  };

  const clearDetail = () => {
    router.replace(explorerHref({ tab: state.tab, page: state.page, source: state.source, ref: state.ref }), { scroll: false });
  };

  const selectBlock = (id: string) => {
    router.push(explorerHref({ tab: "blocks", page: state.page, blockId: id }), { scroll: false });
  };

  const selectAnchor = (id: string, page = state.page) => {
    router.push(explorerHref({ tab: "anchors", page, source: state.source, ref: state.ref, anchorId: id }), { scroll: false });
  };

  const openBlockFromAnchor = (id: string) => {
    router.push(explorerHref({ tab: "blocks", blockId: id }), { scroll: false });
  };

  const changePage = (next: number) => {
    const totalPages = state.tab === "blocks" ? blocks?.totalPages ?? 1 : anchors?.totalPages ?? 1;
    const page = Math.min(Math.max(1, next), totalPages);
    if (page === state.page) return;
    router.replace(explorerHref({ ...state, page, blockId: null, anchorId: null }), { scroll: false });
  };

  const applyAnchorFilters = (source: AnchorSource | undefined, ref: string) => {
    router.replace(explorerHref({ tab: "anchors", source, ref: ref.trim() || undefined, page: 1 }), { scroll: false });
  };

  const activeBlockDetail = state.tab === "blocks" && state.blockId
    ? blockDetail?.id === state.blockId ? blockDetail : { id: state.blockId, data: null, error: false }
    : null;
  const activeAnchorDetail = state.tab === "anchors" && state.anchorId
    ? anchorDetail?.id === state.anchorId ? anchorDetail : { id: state.anchorId, data: null, error: false }
    : null;

  return (
    <div className={styles.chainBody}>
      <Reveal className={styles.chainReveal}>
        <section className={styles.chainPanel} aria-label={t("chain.explorerLabel")}>
          <div className={styles.chainWorkspaceTabs} role="tablist" aria-label={t("chain.explorerTabs")}>
            <button type="button" role="tab" aria-selected={state.tab === "blocks"} className={state.tab === "blocks" ? `${styles.chainWorkspaceTab} ${styles.chainWorkspaceTabActive}` : styles.chainWorkspaceTab} onClick={() => changeTab("blocks")}><Boxes size={13} aria-hidden="true" /> {t("chain.blocks")}</button>
            <button type="button" role="tab" aria-selected={state.tab === "anchors"} className={state.tab === "anchors" ? `${styles.chainWorkspaceTab} ${styles.chainWorkspaceTabActive}` : styles.chainWorkspaceTab} onClick={() => changeTab("anchors")}><Fingerprint size={13} aria-hidden="true" /> {t("chain.certificates")}</button>
          </div>
          {state.tab === "blocks" ? <BlocksTab blocks={blocks} state={state} detail={activeBlockDetail} info={info} onSelect={selectBlock} onSelectAnchor={(id) => selectAnchor(id, 1)} onClose={clearDetail} onPage={changePage} copied={copied} onCopy={copy} /> : <AnchorsTab key={`${state.source ?? ""}|${state.ref ?? ""}|${state.page}`} anchors={anchors} state={state} detail={activeAnchorDetail} onApply={applyAnchorFilters} onSelect={selectAnchor} onOpenBlock={openBlockFromAnchor} onClose={clearDetail} onPage={changePage} copied={copied} onCopy={copy} />}
        </section>
      </Reveal>
    </div>
  );
}

function BlocksTab({ blocks, state, detail, info, onSelect, onSelectAnchor, onClose, onPage, copied, onCopy }: { blocks: BlocksPage | null; state: ExplorerState; detail: DetailState<ChainBlockDetail> | null; info: ChainInfo | null; onSelect: (id: string) => void; onSelectAnchor: (id: string) => void; onClose: () => void; onPage: (page: number) => void; copied: string | null; onCopy: (value: string, key: string) => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const selected = Boolean(state.blockId);
  return (
    <div className={styles.chainExplorerGrid} data-detail-open={selected}>
      <div className={styles.chainExplorerList}>
        <div className={styles.chainPanelHead}><div><span className={styles.eyebrow}>◈ Blocks</span><h2>{t("chain.blocks")}</h2></div><span className={styles.chainPanelHint}>{t("chain.blocksTotal", { count: info?.height ?? blocks?.totalItems ?? 0 })}</span></div>
        {blocks === null ? <p className={styles.chainEmpty}>{t("chain.unreachable")}</p> : blocks.items.length === 0 ? <p className={styles.chainEmpty}>{t("chain.noBlocks")}</p> : <ul className={styles.chainLedger}>{blocks.items.map((block, index) => <li key={block.id}><button type="button" className={styles.chainLedgerRow} data-selected={state.blockId === block.id} aria-pressed={state.blockId === block.id} onClick={() => onSelect(block.id)}><span className={styles.chainLedgerIndex}>#{block.index}</span><span className={styles.chainLedgerMain}><span className={styles.chainLedgerHash}><HashLine value={block.hash} /></span><span className={styles.chainLedgerMeta}><span>{t("chain.prev")} {shortHash(block.prevHash, 8)}</span><span>{t("chain.root")} {shortHash(block.certRoot, 8)}</span><span>{t("chain.certCount", { count: block.anchorCount })}</span></span></span><span className={styles.chainLedgerRight}><span className={styles.chainLedgerTime}>{formatUtc(block.timestamp, locale)}</span><ChevronDown size={13} aria-hidden="true" className={styles.chainLedgerChevron} data-open={state.blockId === block.id} /></span><span className={styles.chainLedgerSpine} aria-hidden="true" data-last={index === blocks.items.length - 1} /></button></li>)}</ul>}
        {blocks ? <div className={styles.chainPagerWrap}><Pagination page={blocks.page} totalPages={blocks.totalPages} onChange={onPage} label={t("chain.blockPages")} /></div> : null}
      </div>
      {selected ? <BlockDetailPanel detail={detail} onClose={onClose} onSelectAnchor={onSelectAnchor} copied={copied} onCopy={onCopy} /> : <div className={styles.chainExplorerEmpty}><Link2 size={16} aria-hidden="true" /><p>{t("chain.selectBlock")}</p></div>}
    </div>
  );
}

function BlockDetailPanel({ detail, onClose, onSelectAnchor, copied, onCopy }: { detail: DetailState<ChainBlockDetail> | null; onClose: () => void; onSelectAnchor: (id: string) => void; copied: string | null; onCopy: (value: string, key: string) => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  if (!detail || detail.data === null) return <DetailLoading error={detail?.error ?? false} onClose={onClose} />;
  const block = detail.data;
  return (
    <section className={styles.chainExplorerDetail} aria-label={t("chain.blockDetail")}>
      <DetailBack onClose={onClose} label={t("chain.backToBlocks")} />
      <div className={styles.chainDetailTitle}><span className={styles.eyebrow}>◈ Block</span><h2>#{block.index}</h2><span>{formatUtc(block.timestamp, locale)}</span></div>
      <div className={styles.chainDetailFields}>
        <Field label={t("chain.hash")} value={<Copyable value={block.hash} text={shortHash(block.hash, 18)} copyKey={`block-hash-${block.id}`} onCopy={onCopy} copied={copied} />} />
        <Field label={t("chain.prevHash")} value={<Copyable value={block.prevHash} text={shortHash(block.prevHash, 18)} copyKey={`block-prev-${block.id}`} onCopy={onCopy} copied={copied} />} />
        <Field label={t("chain.merkleRoot")} value={<Copyable value={block.certRoot} text={shortHash(block.certRoot, 18)} copyKey={`block-root-${block.id}`} onCopy={onCopy} copied={copied} />} />
        <Field label={t("chain.nonce")} value={String(block.nonce)} />
        <Field label={t("chain.target")} value={block.proofMode === "proof" ? t("chain.zeros", { count: block.difficulty }) : t("chain.simulation")} />
        <Field label={t("chain.certificates")} value={String(block.anchorCount)} />
      </div>
      <div className={styles.chainDetailSectionHead}><span className={styles.eyebrow}>◇ Certificates</span><span>{t("chain.certCount", { count: block.anchors.length })}</span></div>
      {block.anchors.length === 0 ? <p className={styles.chainEmpty}>{t("chain.genesisEmpty")}</p> : <ul className={styles.chainCertList}>{block.anchors.map((anchor) => <li key={anchor.id} className={styles.chainExplorerCert}><button type="button" className={styles.chainExplorerCertButton} onClick={() => onSelectAnchor(anchor.id)}><span className={styles.chainSourceChip}><span className={styles.chainSourceDot} style={{ background: SOURCE_DOTS[anchor.source] }} aria-hidden="true" />{anchor.source}</span><span className={styles.chainCertBody}><strong className={styles.chainCertSummary}>{anchor.summary}</strong><code className={styles.chainMono}>{shortHash(anchor.subjectHash, 16)}</code></span><span className={styles.chainCertStatus} data-status={anchor.status}>{anchor.status === "anchored" ? t("chain.sealed") : t("chain.pending")}</span><span className={styles.chainCertSigned} title={t("chain.signedTitle")}>{anchor.siteSignature ? <><BadgeCheck size={11} aria-hidden="true" /> {t("chain.signed")}</> : t("chain.unsigned")}</span><ArrowRight size={13} aria-hidden="true" /></button></li>)}</ul>}
      <p className={styles.chainDetailFoot}><Hash size={10} aria-hidden="true" /> {t("chain.merkleSealed", { count: block.certIds.length })}</p>
    </section>
  );
}

function AnchorsTab({ anchors, state, detail, onApply, onSelect, onOpenBlock, onClose, onPage, copied, onCopy }: { anchors: AnchorsPage | null; state: ExplorerState; detail: DetailState<ChainAnchor> | null; onApply: (source: AnchorSource | undefined, ref: string) => void; onSelect: (id: string) => void; onOpenBlock: (id: string) => void; onClose: () => void; onPage: (page: number) => void; copied: string | null; onCopy: (value: string, key: string) => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const [refInput, setRefInput] = useState(state.ref ?? "");
  const selected = Boolean(state.anchorId);
  return (
    <div className={styles.chainExplorerGrid} data-detail-open={selected}>
      <div className={styles.chainExplorerList}>
        <div className={styles.chainPanelHead}><div><span className={styles.eyebrow}>◇ Certificates</span><h2>{t("chain.certificates")}</h2></div><span className={styles.chainPanelHint}>{anchors ? t("chain.anchorsTotal", { count: anchors.totalItems }) : "—"}</span></div>
        <div className={styles.chainAnchorFilters}>
          <label><span>{t("chain.source")}</span><select value={state.source ?? ""} onChange={(event) => onApply((event.target.value || undefined) as AnchorSource | undefined, refInput)} aria-label={t("chain.anchorSourceFilter")}><option value="">{t("chain.allSources")}</option>{ANCHOR_SOURCES.map((source) => <option value={source} key={source}>{source}</option>)}</select></label>
          <label className={styles.chainAnchorRef}><span>{t("chain.reference")}</span><input value={refInput} onChange={(event) => setRefInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onApply(state.source ?? undefined, refInput); }} placeholder={t("chain.referencePlaceholder")} aria-label={t("chain.reference")} /></label>
          <button type="button" className={styles.chainFilterButton} onClick={() => onApply(state.source ?? undefined, refInput)}>{t("chain.filter")}</button>
        </div>
        {anchors === null ? <p className={styles.chainEmpty}>{t("chain.unreachable")}</p> : anchors.items.length === 0 ? <p className={styles.chainEmpty}>{t("chain.noAnchors")}</p> : <ul className={styles.chainAnchorList}>{anchors.items.map((anchor) => <li key={anchor.id}><button type="button" className={styles.chainAnchorListRow} data-selected={state.anchorId === anchor.id} onClick={() => onSelect(anchor.id)}><span className={styles.chainSourceChip}><span className={styles.chainSourceDot} style={{ background: SOURCE_DOTS[anchor.source] }} aria-hidden="true" />{anchor.source}</span><span className={styles.chainCertBody}><strong className={styles.chainCertSummary}>{anchor.summary}</strong><code className={styles.chainMono}>{shortHash(anchor.subjectHash, 16)}</code></span><span className={styles.chainCertStatus} data-status={anchor.status}>{anchor.status === "anchored" ? t("chain.sealed") : t("chain.pending")}</span><time dateTime={anchor.createdAt}>{formatUtc(anchor.createdAt, locale)}</time><ArrowRight size={13} aria-hidden="true" /></button></li>)}</ul>}
        {anchors ? <div className={styles.chainPagerWrap}><Pagination page={anchors.page} totalPages={anchors.totalPages} onChange={onPage} label={t("chain.anchorPages")} /></div> : null}
      </div>
      {selected ? <AnchorDetailPanel detail={detail} onClose={onClose} onOpenBlock={onOpenBlock} copied={copied} onCopy={onCopy} /> : <div className={styles.chainExplorerEmpty}><Link2 size={16} aria-hidden="true" /><p>{t("chain.selectAnchor")}</p></div>}
    </div>
  );
}

function AnchorDetailPanel({ detail, onClose, onOpenBlock, copied, onCopy }: { detail: DetailState<ChainAnchor> | null; onClose: () => void; onOpenBlock: (id: string) => void; copied: string | null; onCopy: (value: string, key: string) => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  if (!detail || detail.data === null) return <DetailLoading error={detail?.error ?? false} onClose={onClose} />;
  const anchor = detail.data;
  const verifyHref = toolsHref("verify", { mode: "hash", value: anchor.subjectHash });
  return (
    <section className={styles.chainExplorerDetail} aria-label={t("chain.anchorDetail")}>
      <DetailBack onClose={onClose} label={t("chain.backToCertificates")} />
      <div className={styles.chainDetailTitle}><span className={styles.eyebrow}>◇ Certificate</span><h2>{anchor.summary}</h2><span>{formatUtc(anchor.createdAt, locale)}</span></div>
      <div className={styles.chainDetailStatus} data-status={anchor.status}>{anchor.status === "anchored" ? <><BadgeCheck size={13} aria-hidden="true" /> {t("chain.sealed")}</> : <><Clock size={13} aria-hidden="true" /> {t("chain.pending")}</>}</div>
      <div className={styles.chainReceiptRows}>
        <Row label={t("chain.subjectHash")} value={<Copyable value={anchor.subjectHash} text={shortHash(anchor.subjectHash, 18)} copyKey={`anchor-hash-${anchor.id}`} onCopy={onCopy} copied={copied} />} />
        <Row label={t("chain.certificate")} value={<Copyable value={anchor.id} text={shortHash(anchor.id, 18)} copyKey={`anchor-id-${anchor.id}`} onCopy={onCopy} copied={copied} />} />
        <Row label={t("chain.source")} value={`${anchor.source}${anchor.label ? ` · “${anchor.label}”` : ""}`} />
        <Row label={t("chain.block")} value={anchor.blockId ? <button type="button" className={styles.chainInlineLink} onClick={() => onOpenBlock(anchor.blockId as string)}>{anchor.blockId.replace("block_", "#")} <ArrowRight size={11} aria-hidden="true" /></button> : t("chain.pending")} />
        <Row label="Site key" value={anchor.siteKeyId} />
        <Row label={t("chain.signature")} value={<Copyable value={anchor.siteSignature} text={shortHash(anchor.siteSignature, 18)} copyKey={`anchor-signature-${anchor.id}`} onCopy={onCopy} copied={copied} />} />
        <Row label={t("chain.publicKey")} value={<Copyable value={anchor.sitePublicKey} text={shortHash(anchor.sitePublicKey, 18)} copyKey={`anchor-key-${anchor.id}`} onCopy={onCopy} copied={copied} />} />
      </div>
      {anchor.target ? <Link className={styles.chainTargetLink} href={anchor.target.href}>{anchor.target.label} <ArrowRight size={12} aria-hidden="true" /></Link> : null}
      <div className={styles.chainDetailActions}><Link className={styles.chainButtonSecondary} href={verifyHref}><ShieldCheck size={12} aria-hidden="true" /> {t("chain.verifyThis")}</Link></div>
      <details className={styles.chainMetadataDisclosure}><summary>{t("chain.metadata")}</summary><pre>{JSON.stringify(anchor.metadata, null, 2)}</pre></details>
    </section>
  );
}

function DetailBack({ onClose, label }: { onClose: () => void; label: string }) {
  return <button type="button" className={styles.chainDetailBack} onClick={onClose}><ArrowLeft size={15} aria-hidden="true" /> {label}</button>;
}

function DetailLoading({ error, onClose }: { error: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return <section className={styles.chainExplorerDetail}><DetailBack onClose={onClose} label={t("chain.backToExplorer")} /><p className={styles.chainEmpty}>{error ? t("chain.requestFailed") : t("chain.loadingDetail")}</p></section>;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className={styles.chainField}><span className={styles.chainFieldLabel}>{label}</span><span className={styles.chainFieldValue}>{value}</span></div>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className={styles.chainReceiptRow}><span className={styles.chainReceiptKey}>{label}</span><span className={styles.chainReceiptValue}>{value}</span></div>;
}

function Copyable({ value, text, copyKey, onCopy, copied }: { value: string; text: string; copyKey: string; onCopy: (value: string, key: string) => Promise<void>; copied: string | null }) {
  const { t } = useTranslation();
  return <span className={styles.chainCopyable}><code className={styles.chainMono}>{text}</code><button type="button" className={styles.chainCopyButton} onClick={() => void onCopy(value, copyKey)} aria-label={t("chain.copy")}>{copied === copyKey ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}</button></span>;
}

function HashLine({ value }: { value: string }) {
  const shown = value.length <= 24 ? value : `${value.slice(0, 16)}…${value.slice(-6)}`;
  const zeros = /^0+/.exec(shown)?.[0] ?? "";
  return <span className={styles.chainMono}>{zeros ? <em className={styles.chainZeros}>{zeros}</em> : null}{shown.slice(zeros.length)}</span>;
}

function shortHash(value: string, head = 10): string {
  if (!value) return "—";
  return value.length <= head + 7 ? value : `${value.slice(0, head)}…${value.slice(-6)}`;
}

function formatUtc(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(date)} UTC`;
}
