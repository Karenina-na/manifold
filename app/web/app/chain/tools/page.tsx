import type { Metadata } from "next";
import { Suspense } from "react";
import { getServerI18n } from "../../../i18n/i18n-server";
import { BackLink } from "../../../features/content/back-link";
import { ChainTools } from "../../../features/chain/chain-tools";
import { Reveal } from "../../../components/ui/reveal";
import styles from "../../site.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return { title: `${t("chain.tools")} · ${t("chain.title")}`, description: t("chain.description") };
}

export default async function ChainToolsPage() {
  const { t } = await getServerI18n();
  return (
    <main className={styles.page} data-route="chain">
      <div className={styles.chainShell}>
        <Reveal className={styles.chainReveal}>
          <div className={styles.chainBack}><BackLink href="/chain" label={t("chain.backToChain")} canGoBack={false} /></div>
          <header className={styles.chainHero}>
            <div><span className={styles.eyebrow}>✦ Tools</span><h1>{t("chain.tools")}</h1></div>
            <div className={styles.chainHeroStatus}><span className={styles.chainPulse}><span className={styles.chainPulseDot} aria-hidden="true" /> Mining</span><span className={styles.chainHeroTip}>{t("chain.permissionless")}</span></div>
          </header>
        </Reveal>
        <Suspense fallback={null}><ChainTools /></Suspense>
      </div>
    </main>
  );
}
