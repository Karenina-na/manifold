import Link from "next/link";
import { ArrowUpRight, MapPin } from "lucide-react";
import { loadHomeData, formatDate } from "../lib/api";
import styles from "./site.module.css";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await loadHomeData();
  const profile = data.profile;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        {data.error && <p className={styles.errorBanner}>{data.error}</p>}
        <section className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>Living digital garden</span>
            <h1>{profile?.headline ?? "Research, systems, and the questions between them."}</h1>
            <p className={styles.heroLead}>{profile?.bio ?? "A small archive of thoughts and long-form technical writing."}</p>
            <div className={styles.tags}>{(profile?.interests ?? ["systems", "research", "writing"]).map((interest) => <span className={styles.tag} key={interest}>#{interest}</span>)}</div>
            <div className={styles.heroMeta}>
              <span className={styles.avatar}>{profile?.displayName?.slice(0, 1) ?? "M"}</span>
              <span><strong>{profile?.displayName ?? "Manifold"}</strong><br />{profile?.location ? <><MapPin size={12} /> {profile.location}</> : "Independent technology, thoughts, and manuscripts"}</span>
            </div>
          </div>
          <aside className={styles.heroAside}>
            <span className={styles.nowTag}><span className={styles.pulse} /> Now</span>
            <h2>{data.now?.title ?? "Building the first garden"}</h2>
            <p>{data.now?.detail ?? "Shaping a small API-first space for technology, thoughts, and manuscripts."}</p>
          </aside>
        </section>

        <section className={styles.statsBar} aria-label="Garden statistics">
          <div className={styles.stat}><strong>{data.stats?.contentCount ?? 0}</strong><span>Published pieces</span></div>
          <div className={styles.stat}><strong>{data.stats?.wordCount ?? 0}</strong><span>Words in the garden</span></div>
          <div className={styles.stat}><strong>{data.stats?.articleCount ?? 0}</strong><span>Writings</span></div>
          <div className={styles.stat}><strong>{data.stats?.thoughtCount ?? 0}</strong><span>Thoughts</span></div>
        </section>

        <section className={styles.section} aria-labelledby="cv-heading"><div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Compact CV</span><h2 id="cv-heading">The work behind the archive</h2></div>{profile?.resumeUrl && <a href={profile.resumeUrl} download>Download PDF <ArrowUpRight size={14} /></a>}</div><div className={styles.stream}>{(profile?.education ?? []).map((item) => <div className={styles.streamItem} key={`${item.institution}-${item.period}`}><time>{item.period}</time><div><h3>{item.institution}</h3><p>{item.program}</p></div><span className={styles.kind}>EDUCATION</span></div>)}{(profile?.experience ?? []).map((item) => <div className={styles.streamItem} key={`${item.organization}-${item.period}`}><time>{item.period}</time><div><h3>{item.organization}</h3><p>{item.role}</p></div><span className={styles.kind}>EXPERIENCE</span></div>)}</div></section>
        <section className={styles.section} aria-labelledby="recent-heading"><div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Recent activity</span><h2 id="recent-heading">Two writings, three thoughts.</h2></div><Link href="/writing">Browse writings <ArrowUpRight size={14} /></Link></div>{data.feed?.length ? <div className={styles.stream}>{data.feed.map((item) => <Link className={styles.streamItem} key={item.id} href={item.href}><time dateTime={item.publishedAt ?? item.createdAt}>{formatDate(item.publishedAt ?? item.createdAt)}</time><div><h3>{item.title || 'A thought'}</h3><p>{item.summary || item.body}</p></div><span className={styles.kind}>{item.kind}</span></Link>)}</div> : <p className={styles.muted}>The stream is quiet for now.</p>}</section>

        <footer className={styles.footer}><span>Made for the thoughts that do not fit elsewhere.</span><a href={profile?.websiteUrl || "mailto:hello@manifold.local"}>{profile?.websiteUrl ? "Visit the wider site" : "Get in touch"}</a></footer>
      </div>
    </main>
  );
}
