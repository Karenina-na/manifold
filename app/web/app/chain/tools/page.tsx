import type { Metadata } from "next";
import { headers } from "next/headers";
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
  const [{ t }, requestHeaders] = await Promise.all([getServerI18n(), headers()]);
  const referrer = requestHeaders.get("referer");
  const host = requestHeaders.get("host");
  const canGoBack = !!referrer && !!host && (() => { try { return new URL(referrer).host === host; } catch { return false; } })();
  return (
    <main className={styles.page} data-route="chain">
      <div className={styles.chainShell}>
        <Reveal className={styles.chainReveal}>
          <div className={styles.chainBack}><BackLink href="/chain" label={t("chain.backToChain")} canGoBack={canGoBack} /></div>
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
