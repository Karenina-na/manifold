import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createServerClient, formatDate } from "../../lib/api";
import styles from "../site.module.css";

export const dynamic = "force-dynamic";

export default async function ThoughtsPage() {
  const feed = await createServerClient().content({ limit: 50, kind: "THOUGHT" }).catch(() => null);
  return <main className={styles.page}><div className={styles.shell}><section className={styles.section}><Link className={styles.sectionHeading} href="/"><span><ArrowLeft size={15} /> Back home</span></Link><div className={styles.hero} style={{ paddingTop: 40 }}><div><span className={styles.eyebrow}>Thoughts</span><h1>Short notes and questions.</h1></div><p className={styles.heroLead}>Methods, reading notes, and questions in progress.</p></div>{feed ? <div className={styles.stream}>{feed.data.map((item) => <Link className={styles.streamItem} key={item.id} href={item.href}><time dateTime={item.publishedAt ?? item.createdAt}>{formatDate(item.publishedAt ?? item.createdAt)}</time><div><h3>{item.title || 'A thought'}</h3><p>{item.summary || item.body}</p><div className={styles.tags}>{item.tags.map((tag) => <span className={styles.tag} key={tag}>#{tag}</span>)}</div></div><span className={styles.kind}>THOUGHT</span></Link>)}</div> : <p className={styles.errorBanner}>Thoughts could not be loaded. Core may be restarting.</p>}</section></div></main>;
}
