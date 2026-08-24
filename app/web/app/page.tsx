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
            <h1>Ideas are better when they have a place to <em>grow.</em></h1>
            <p className={styles.heroLead}>{profile?.bio ?? "A small, evolving space for technology, thoughts, and manuscripts."}</p>
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
          <div className={styles.stat}><strong>{data.stats?.techCount ?? 0}</strong><span>Technology</span></div>
          <div className={styles.stat}><strong>{data.stats?.thoughtCount ?? 0}</strong><span>Thoughts</span></div>
          <div className={styles.stat}><strong>{data.stats?.manuscriptCount ?? 0}</strong><span>Manuscripts</span></div>
        </section>

        <section className={styles.section} aria-labelledby="recent-heading">
          <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Recent writing</span><h2 id="recent-heading">A stream of things noticed</h2></div><Link href="/writing">View all <ArrowUpRight size={14} /></Link></div>
          {data.feed?.data.length ? <div className={styles.stream}>{data.feed.data.map((item) => <Link className={styles.streamItem} key={item.id} href={item.href}><time dateTime={item.publishedAt ?? item.createdAt}>{formatDate(item.publishedAt ?? item.createdAt)}</time><div><h3>{item.title}</h3><p>{item.summary}</p><div className={styles.tags}>{item.tags.map((tag) => <span className={styles.tag} key={tag}>#{tag}</span>)}</div></div><span className={styles.kind}>{item.kind}</span></Link>)}</div> : <p className={styles.muted}>The stream is quiet for now.</p>}
        </section>

        <footer className={styles.footer}><span>Made for the thoughts that do not fit elsewhere.</span><a href={profile?.websiteUrl || "mailto:hello@manifold.local"}>{profile?.websiteUrl ? "Visit the wider site" : "Get in touch"}</a></footer>
      </div>
    </main>
  );
}
