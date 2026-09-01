import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import styles from "../../site.module.css";

export default function WritingNotFound() {
  return <main className={styles.page}><div className={styles.shell}><section className={styles.section}><div className="articleBack"><Link href="/writing"><ArrowLeft size={15} /> Back to writing</Link></div><h1>That piece is not here.</h1><p className={styles.muted}>It may be unpublished or the link may have changed.</p></section></div></main>;
}
