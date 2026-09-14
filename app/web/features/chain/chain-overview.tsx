import Link from "next/link";
import { ArrowRight, Boxes, Clock, Cpu, Fingerprint, KeyRound, ScanLine } from "lucide-react";
import type { ChainAnchor, ChainBlockSummary, ChainInfo, Collection } from "@manifold/contracts";
import { getServerI18n } from "../../i18n/i18n-server";
import { Reveal } from "../../components/ui/reveal";
import { explorerHref, toolsHref } from "./chain-url";
import styles from "../../app/site.module.css";

type ChainOverviewProps = {
  info: ChainInfo | null;
  blocks: Collection<ChainBlockSummary> | null;
  anchors: Collection<ChainAnchor> | null;
};

export async function ChainOverview({ info, blocks, anchors }: ChainOverviewProps) {
  const { t } = await getServerI18n();
  return (
    <div className={styles.chainBody}>
      <Reveal className={styles.chainReveal}>
        <section className={styles.chainPanel} aria-label={t("chain.overview")}>
          <div className={styles.chainStats}>
            <Stat icon={<Boxes size={12} aria-hidden="true" />} label="Height" value={info ? String(info.height) : "—"} sub={t("chain.sealedBlocks")} />
            <Stat icon={<Fingerprint size={12} aria-hidden="true" />} label="Commitments" value={info ? String(info.totalAnchors) : "—"} sub={info ? t("chain.inMempool", { count: info.pendingAnchors }) : "—"} />
            <Stat icon={<Cpu size={12} aria-hidden="true" />} label="Proof" value={info ? (info.proofMode === "proof" ? "Proof" : t("chain.simulation")) : "—"} sub={info && info.proofMode === "proof" ? t("chain.leadingZeros", { count: info.difficulty }) : info ? t("chain.trivialTarget") : "—"} />
            <Stat icon={<KeyRound size={12} aria-hidden="true" />} label="Site key" value={<span className={styles.chainMono}>{info ? shortHash(info.sitePublicKey) : "—"}</span>} sub={t("chain.ed25519Public")} />
          </div>
          <div className={styles.chainLinkStrip}>
            <span>{t("chain.genesis")}</span>
            <code className={styles.chainMono}>{info ? shortHash(info.genesisHash, 12) : "—"}</code>
            <span className={styles.chainLinkRule} aria-hidden="true" />
            <span>{t("chain.tip")}</span>
            <code className={styles.chainMono}>{info ? shortHash(info.tipHash, 12) : "—"}</code>
          </div>
        </section>
      </Reveal>

      <Reveal className={styles.chainReveal}>
        <section className={styles.chainPanel} aria-label={t("chain.routesLabel")}>
          <div className={styles.chainPanelHead}>
            <div>
              <span className={styles.eyebrow}>◇ Chain map</span>
              <h2>{t("chain.choosePath")}</h2>
            </div>
            <span className={styles.chainPanelHint}>{t("chain.overviewHint")}</span>
          </div>
          <p className={styles.chainOverviewIntro}>{t("chain.overviewIntro")}</p>
          <div className={styles.chainEntryGrid}>
            <Link className={styles.chainEntry} href={explorerHref({ tab: "blocks" })}>
              <span className={styles.chainEntryIcon}><Boxes size={17} aria-hidden="true" /></span>
              <span className={styles.chainEntryBody}><strong>{t("chain.explore")}</strong><span>{t("chain.exploreBody")}</span></span>
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
            <Link className={styles.chainEntry} href={toolsHref()}>
              <span className={styles.chainEntryIcon}><ScanLine size={17} aria-hidden="true" /></span>
              <span className={styles.chainEntryBody}><strong>{t("chain.tools")}</strong><span>{t("chain.toolsBody")}</span></span>
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </section>
      </Reveal>

      <Reveal className={styles.chainReveal}>
        <section className={styles.chainPanel} aria-label={t("chain.recentLabel")}>
          <div className={styles.chainRecentGrid}>
            <RecentBlocks blocks={blocks?.data ?? []} t={t} />
            <RecentAnchors anchors={anchors?.data ?? []} t={t} />
          </div>
        </section>
      </Reveal>

      <Reveal className={styles.chainReveal}>
        <section className={styles.chainPanel} aria-label={t("chain.how")}>
          <div className={styles.chainPrimer}>
            <div className={styles.chainPrimerStep}><span className={styles.chainPrimerIndex}>01</span><span className={styles.chainPrimerTitle}>{t("chain.commit")}</span><p className={styles.chainPrimerBody}>{t("chain.commitBody")}</p></div>
            <div className={styles.chainPrimerStep}><span className={styles.chainPrimerIndex}>02</span><span className={styles.chainPrimerTitle}>{t("chain.sign")}</span><p className={styles.chainPrimerBody}>{t("chain.signBody")}</p></div>
            <div className={styles.chainPrimerStep}><span className={styles.chainPrimerIndex}>03</span><span className={styles.chainPrimerTitle}>{t("chain.seal")}</span><p className={styles.chainPrimerBody}>{t("chain.sealBody")}</p></div>
          </div>
        </section>
      </Reveal>
    </div>
  );
}

function RecentBlocks({ blocks, t }: { blocks: ChainBlockSummary[]; t: (key: string, options?: Record<string, unknown>) => string }) {
  return (
    <section className={styles.chainRecentColumn} aria-labelledby="chain-recent-blocks">
      <div className={styles.chainRecentHead}><div><span className={styles.eyebrow}>◈ Blocks</span><h2 id="chain-recent-blocks">{t("chain.latestBlocks")}</h2></div><Link href={explorerHref({ tab: "blocks" })}>{t("chain.viewAll")} <ArrowRight size={12} aria-hidden="true" /></Link></div>
      {blocks.length === 0 ? <p className={styles.chainEmpty}>{t("chain.noBlocks")}</p> : <ul className={styles.chainRecentList}>{blocks.map((block) => <li key={block.id}><Link href={explorerHref({ tab: "blocks", blockId: block.id })}><span className={styles.chainRecentIndex}>#{block.index}</span><span className={styles.chainRecentMain}><strong>{shortHash(block.hash, 16)}</strong><span>{t("chain.certCount", { count: block.anchorCount })} · {block.proofMode === "proof" ? t("chain.zeros", { count: block.difficulty }) : t("chain.simulation")}</span></span><time dateTime={block.timestamp}><Clock size={11} aria-hidden="true" /> {formatUtc(block.timestamp)}</time><ArrowRight size={12} aria-hidden="true" /></Link></li>)}</ul>}
    </section>
  );
}

function RecentAnchors({ anchors, t }: { anchors: ChainAnchor[]; t: (key: string, options?: Record<string, unknown>) => string }) {
  return (
    <section className={styles.chainRecentColumn} aria-labelledby="chain-recent-anchors">
      <div className={styles.chainRecentHead}><div><span className={styles.eyebrow}>◇ Certificates</span><h2 id="chain-recent-anchors">{t("chain.latestAnchors")}</h2></div><Link href={explorerHref({ tab: "anchors" })}>{t("chain.viewAll")} <ArrowRight size={12} aria-hidden="true" /></Link></div>
      {anchors.length === 0 ? <p className={styles.chainEmpty}>{t("chain.noAnchors")}</p> : <ul className={styles.chainRecentList}>{anchors.map((anchor) => <li key={anchor.id}><Link href={explorerHref({ tab: "anchors", anchorId: anchor.id })}><span className={styles.chainRecentIndex} data-source={anchor.source}>{anchor.source}</span><span className={styles.chainRecentMain}><strong>{anchor.summary}</strong><span>{shortHash(anchor.subjectHash, 16)} · {anchor.status === "anchored" ? t("chain.sealed") : t("chain.pending")}</span></span><time dateTime={anchor.createdAt}><Clock size={11} aria-hidden="true" /> {formatUtc(anchor.createdAt)}</time><ArrowRight size={12} aria-hidden="true" /></Link></li>)}</ul>}
    </section>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub: string }) {
  return <div className={styles.chainStat}><span className={styles.chainStatLabel}>{icon} {label}</span><span className={styles.chainStatValue}>{value}</span><span className={styles.chainStatSub}>{sub}</span></div>;
}

function formatUtc(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(date)} UTC`;
}

function shortHash(value: string, head = 10): string {
  if (!value) return "—";
  return value.length <= head + 7 ? value : `${value.slice(0, head)}…${value.slice(-6)}`;
}
