import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createServerClient, formatDate } from "../../lib/api";
import styles from "../site.module.css";

export const dynamic = "force-dynamic";

export default async function WritingPage() {
  const feed = await createServerClient().content({ limit: 50, kind: "ARTICLE" }).catch(() => null);
  return <main className={styles.page}><div className={styles.shell}><section className={styles.section}><Link className={styles.sectionHeading} href="/"><span><ArrowLeft size={15} /> Back home</span></Link><div className={styles.hero} style={{ paddingTop: 40 }}><div><span className={styles.eyebrow}>Writings</span><h1>Articles and experiments.</h1></div><p className={styles.heroLead}>Technical essays, experiments, and architecture notes.</p></div>{feed ? <div className={styles.stream}>{feed.data.map((item) => { const minutes = item.kind === 'ARTICLE' ? item.metadata.readingMinutes : undefined; return <Link className={styles.streamItem} key={item.id} href={item.href}><time dateTime={item.publishedAt ?? item.createdAt}>{formatDate(item.publishedAt ?? item.createdAt)}</time><div><h3>{item.title}</h3><p>{item.summary}</p><div className={styles.tags}>{item.tags.map((tag) => <span className={styles.tag} key={tag}>#{tag}</span>)}</div></div><span className={styles.kind}>{minutes ? `${minutes} min` : 'ARTICLE'}</span></Link> })}</div> : <p className={styles.errorBanner}>The archive could not be loaded. Core may be restarting.</p>}</section></div></main>;
}
