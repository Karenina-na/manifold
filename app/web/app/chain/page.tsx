import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createServerClient } from "../../lib/api";
import { getServerI18n } from "../../i18n/i18n-server";
import { ChainOverview } from "../../features/chain/chain-overview";
import { legacyChainHref } from "../../features/chain/chain-url";
import { Reveal } from "../../components/ui/reveal";
import styles from "../site.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return { title: t("chain.title"), description: t("chain.description") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ChainPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const legacyParams = new URLSearchParams();
  for (const key of ["block", "page"]) {
    const value = params[key];
    if (typeof value === "string") legacyParams.set(key, value);
  }
  const legacyHref = legacyChainHref(legacyParams);
  if (legacyHref) redirect(legacyHref);

  const client = createServerClient();
  const [info, blocks, anchors, { t }] = await Promise.all([
    client.chain().catch(() => null),
    client.chainBlocks({ pageSize: 5 }).catch(() => null),
    client.chainAnchors({ pageSize: 5 }).catch(() => null),
    getServerI18n(),
  ]);
  return (
    <main className={styles.page} data-route="chain">
      <div className={styles.chainShell}>
        <Reveal className={styles.chainReveal}>
          <header className={styles.chainHero}>
            <div>
              <span className={styles.eyebrow}>◇ Anchoring chain</span>
              <h1>{t("chain.title")}</h1>
            </div>
            <div className={styles.chainHeroStatus}>
              <span className={styles.chainPulse}><span className={styles.chainPulseDot} aria-hidden="true" /> Mining</span>
              <span className={styles.chainHeroTip}>
                {t("chain.tip")} <code className={styles.chainMono}>{info ? info.tipHash.slice(0, 12) : "—"}</code>
              </span>
            </div>
          </header>
        </Reveal>
        <ChainOverview info={info} blocks={blocks} anchors={anchors} />
      </div>
    </main>
  );
}
