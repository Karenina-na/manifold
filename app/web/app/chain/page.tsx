import type { Metadata } from "next";
import { createServerClient } from "../../lib/api";
import { ChainExplorer } from "../../components/chain-explorer";
import styles from "../site.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Chain", description: "Anchoring chain explorer: blocks, certificates, and verification." };

export default async function ChainPage() {
  const client = createServerClient();
  const [info, blocks] = await Promise.all([
    client.chain().catch(() => null),
    client.chainBlocks({ pageSize: 20 }).catch(() => null),
  ]);
  return (
    <main className={styles.page}>
      <div className={styles.chainShell}>
        <header className={styles.chainHero}>
          <span className="eyebrow">Anchoring chain</span>
          <h1>Chain</h1>
          <p>
            Every database write on this site is committed as a SHA-256 certificate and sealed into
            proof-of-work blocks. Anyone can submit a payload for anchoring or verify one — the chain
            proves what existed, when, signed by this site&rsquo;s key.
          </p>
        </header>
        <ChainExplorer
          info={info}
          initialBlocks={blocks ? { items: blocks.data, page: blocks.pagination.page, totalPages: blocks.pagination.totalPages } : null}
        />
      </div>
    </main>
  );
}
