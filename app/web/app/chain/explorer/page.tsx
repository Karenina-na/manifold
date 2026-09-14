import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createServerClient } from "../../../lib/api";
import { getServerI18n } from "../../../i18n/i18n-server";
import { BackLink } from "../../../features/content/back-link";
import { ChainExplorer, type AnchorsPage, type BlocksPage } from "../../../features/chain/chain-explorer";
import { explorerHref, readExplorerState } from "../../../features/chain/chain-url";
import { Reveal } from "../../../components/ui/reveal";
import styles from "../../site.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return { title: `${t("chain.explore")} · ${t("chain.title")}`, description: t("chain.description") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ChainExplorerPage({ searchParams }: { searchParams: SearchParams }) {
  const rawSearchParams = await searchParams;
  const params = new URLSearchParams();
  for (const key of ["tab", "source", "ref", "page", "block", "anchor"]) {
    const value = rawSearchParams[key];
    if (typeof value === "string") params.set(key, value);
  }
  const state = readExplorerState(params);
  const requestHeaders = await headers();
  const referrer = requestHeaders.get("referer");
  const host = requestHeaders.get("host");
  const canGoBack = !!referrer && !!host && (() => { try { return new URL(referrer).host === host; } catch { return false; } })();
  const client = createServerClient();
  const [info, blocks, anchors, { t }] = await Promise.all([
    client.chain().catch(() => null),
    state.tab === "blocks" ? client.chainBlocks({ page: state.page, pageSize: 20 }).catch(() => null) : Promise.resolve(null),
    state.tab === "anchors" ? client.chainAnchors({ source: state.source ?? undefined, ref: state.ref ?? undefined, page: state.page, pageSize: 20 }).catch(() => null) : Promise.resolve(null),
    getServerI18n(),
  ]);
  if (state.tab === "blocks" && blocks && blocks.pagination.page !== state.page) {
    redirect(explorerHref({ ...state, page: blocks.pagination.page }));
  }
  if (state.tab === "anchors" && anchors && anchors.pagination.page !== state.page) {
    redirect(explorerHref({ ...state, page: anchors.pagination.page }));
  }
  const initialBlocks: BlocksPage | null = blocks ? { items: blocks.data, page: blocks.pagination.page, totalItems: blocks.pagination.totalItems, totalPages: blocks.pagination.totalPages } : null;
  const initialAnchors: AnchorsPage | null = anchors ? { items: anchors.data, page: anchors.pagination.page, totalItems: anchors.pagination.totalItems, totalPages: anchors.pagination.totalPages, source: state.source, ref: state.ref } : null;
  return (
    <main className={styles.page} data-route="chain">
      <div className={styles.chainShell}>
        <Reveal className={styles.chainReveal}>
          <div className={styles.chainBack}><BackLink href="/chain" label={t("chain.backToChain")} canGoBack={canGoBack} /></div>
          <header className={styles.chainHero}>
            <div><span className={styles.eyebrow}>◇ Explore</span><h1>{t("chain.explore")}</h1></div>
            <div className={styles.chainHeroStatus}><span className={styles.chainPulse}><span className={styles.chainPulseDot} aria-hidden="true" /> Mining</span><span className={styles.chainHeroTip}>{t("chain.blocksTotal", { count: info?.height ?? 0 })}</span></div>
          </header>
        </Reveal>
        <Suspense fallback={null}>
          <ChainExplorer info={info} initialBlocks={initialBlocks} initialAnchors={initialAnchors} />
        </Suspense>
      </div>
    </main>
  );
}
