import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { createServerClient, formatDate } from "../../lib/api";
import styles from "../site.module.css";

export const dynamic = "force-dynamic";

export default async function WritingPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const params = await searchParams;
  const kind = params.kind === "TECH" || params.kind === "THOUGHT" || params.kind === "MANUSCRIPT" ? params.kind : undefined;
  const feed = await createServerClient().content({ limit: 50, kind }).catch(() => null);
  const heading = kind === "TECH" ? "Technology in motion." : kind === "THOUGHT" ? "Thoughts taking shape." : kind === "MANUSCRIPT" ? "Manuscripts in progress." : "Technology, thoughts, and manuscripts.";
  return <main className={styles.page}><div className={styles.shell}><section className={styles.section}><Link className={styles.sectionHeading} href="/"><span><ArrowLeft size={15} /> Back home</span></Link><div className={styles.hero} style={{ paddingTop: 40 }}><div><span className={styles.eyebrow}>The archive</span><h1>{heading}</h1></div><p className={styles.heroLead}>A focused collection of technical records, thoughts, and manuscript drafts that are ready to be read.</p></div>{feed ? <div className={styles.stream}>{feed.data.map((item) => <Link className={styles.streamItem} key={item.id} href={item.href}><time dateTime={item.publishedAt ?? item.createdAt}>{formatDate(item.publishedAt ?? item.createdAt)}</time><div><h3>{item.title}</h3><p>{item.summary}</p><div className={styles.tags}>{item.tags.map((tag) => <span className={styles.tag} key={tag}>#{tag}</span>)}</div></div><span className={styles.kind}>{item.kind}</span></Link>)}</div> : <p className={styles.errorBanner}>The archive could not be loaded. Core may be restarting.</p>}</section><footer className={styles.footer}><span>One piece at a time.</span><Link href="/">Back home <ArrowUpRight size={14} /></Link></footer></div></main>;
}
