import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { ContentDetail } from "@manifold/contracts";
import styles from "../app/site.module.css";

type AnchorBadgeProps = { latestAnchor: ContentDetail["latestAnchor"] };

// latestAnchor is null before any write has been anchored; the badge renders
// nothing rather than advertising an absent chain state. It rides at the end
// of the articleMeta row (right-bottom of the title block) for both detail
// surfaces.
export function AnchorBadge({ latestAnchor }: AnchorBadgeProps) {
  if (!latestAnchor) return null;
  const anchored = latestAnchor.status === "anchored";
  const blockLabel = anchored && latestAnchor.blockId ? latestAnchor.blockId.replace("block_", "block #") : "sealing…";
  // Sealed anchors deep-link to their block in the chain explorer's Sealed
  // sequence (?block=), so a click lands on the exact certificate that this
  // content is committed to; unsealed ones just open the explorer.
  const href = anchored && latestAnchor.blockId ? `/chain?block=${latestAnchor.blockId}` : "/chain";
  return (
    <Link href={href} className={styles.anchorBadge} data-anchored={anchored} title={`Fingerprint ${latestAnchor.subjectHash}`}>
      <ShieldCheck size={13} aria-hidden="true" />
      <span className={styles.anchorBadgeHash}>{latestAnchor.subjectHash.slice(0, 12)}</span>
      <span className={styles.anchorBadgeState}>{blockLabel}</span>
    </Link>
  );
}
