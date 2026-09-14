"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { ContentDetail } from "@manifold/contracts";
import styles from "../../app/site.module.css";
import { useLocale } from "../../components/layout/i18n-provider";
import { explorerHref, toolsHref } from "../chain/chain-url";

type AnchorBadgeProps = { latestAnchor: ContentDetail["latestAnchor"] };

// latestAnchor is null before any write has been anchored; the badge renders
// nothing rather than advertising an absent chain state. It rides at the end
// of the articleMeta row (right-bottom of the title block) for both detail
// surfaces.
export function AnchorBadge({ latestAnchor }: AnchorBadgeProps) {
  const { t } = useLocale();
  if (!latestAnchor) return null;
  const anchored = latestAnchor.status === "anchored";
  const blockLabel = anchored && latestAnchor.blockId ? `${t("chain.block")} #${latestAnchor.blockId.replace("block_", "")}` : t("detail.sealing");
  const href = anchored && latestAnchor.blockId ? explorerHref({ tab: "blocks", blockId: latestAnchor.blockId }) : toolsHref("submit");
  return (
    <Link href={href} className={styles.anchorBadge} data-anchored={anchored} title={t("detail.fingerprint", { hash: latestAnchor.subjectHash })}>
      <ShieldCheck size={13} aria-hidden="true" />
      <span className={styles.anchorBadgeHash}>{latestAnchor.subjectHash.slice(0, 12)}</span>
      <span className={styles.anchorBadgeState}>{blockLabel}</span>
    </Link>
  );
}
