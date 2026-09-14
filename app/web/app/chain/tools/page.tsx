import type { Metadata } from "next";
import Link from "next/link";
import { createServerClient } from "../../../lib/api";
import { getServerI18n } from "../../../i18n/i18n-server";
import { ChainTools } from "../../../features/chain/chain-tools";
import { Reveal } from "../../../components/ui/reveal";
import styles from "../../site.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return { title: `${t("chain.tools")} · ${t("chain.title")}`, description: t("chain.description") };
}

export default async function ChainToolsPage() {
  const client = createServerClient();
  const [info, blocks, { t }] = await Promise.all([
    client.chain().catch(() => null),
    client.chainBlocks({ pageSize: 20 }).catch(() => null),
    getServerI18n(),
  ]);
  return (
    <main className={styles.page} data-route="chain">
      <div className={styles.chainShell}>
        <Reveal className={styles.chainReveal}>
          <div className={styles.chainBack}><Link href="/chain">← {t("chain.title")}</Link></div>
          <header className={styles.chainHero}>
            <div><span className={styles.eyebrow}>✦ Tools</span><h1>{t("chain.tools")}</h1></div>
            <div className={styles.chainHeroStatus}><span className={styles.chainPulse}><span className={styles.chainPulseDot} aria-hidden="true" /> Mining</span><span className={styles.chainHeroTip}>{t("chain.permissionless")}</span></div>
          </header>
        </Reveal>
        <ChainTools info={info} initialBlocks={blocks ? { items: blocks.data, page: blocks.pagination.page, totalPages: blocks.pagination.totalPages } : null} />
      </div>
    </main>
  );
}
