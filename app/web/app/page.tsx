import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { buildHref, loadHomeData } from "../lib/api";
import { buildUpdateTimeline } from "../lib/update-timeline";
import { Reveal } from "../components/reveal";
import { UpdateTimelineView } from "../components/update-timeline";
import { MinimalMetadata } from "../components/minimal-metadata";
import { ContactLinks, SeriesLinks } from "../components/profile-surfaces";
import type { Content, HomepageSection } from "@manifold/contracts";
import styles from "./site.module.css";

export const dynamic = "force-dynamic";

const defaultSections: HomepageSection[] = ["PROFILE", "BACKGROUND", "RECENT_CONTENT", "UPDATES", "SERIES", "CONTACT"];

const sectionMeta: Record<HomepageSection, { label: string; target: string; preview: string }> = {
  PROFILE: { label: "Profile", target: "profile-section", preview: "Introduction and current focus" },
  BACKGROUND: { label: "Background", target: "background-section", preview: "Education and experience" },
  RECENT_CONTENT: { label: "Recent content", target: "recent-content-section", preview: "Writings and thoughts" },
  UPDATES: { label: "Updates", target: "updates-section", preview: "Content updates timeline" },
  SERIES: { label: "My Series", target: "series-section", preview: "Services and tools" },
  CONTACT: { label: "Contact", target: "contact-section", preview: "Public links and contact points" },
};

function formatWordCount(count: number) {
  return new Intl.NumberFormat("en").format(count);
}

function getRelativeDate(value: string | null | undefined) {
  if (!value) return "Undated";
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export default async function Home() {
  const data = await loadHomeData();
  const profile = data.profile;
  const sections = data.site?.sections?.length ? data.site.sections : defaultSections;
  const stats = data.stats;
  const tags = data.tags ?? [];
  const writings = data.feed?.filter((item) => item.kind === "ARTICLE").slice(0, 3) ?? [];
  const thoughts = data.feed?.filter((item) => item.kind === "THOUGHT").slice(0, 3) ?? [];
  const initials = profile?.displayName?.slice(0, 1).toUpperCase() ?? "M";
  const updateTimeline = buildUpdateTimeline(data.timeline);
  const contactLinks = [
	    ...(profile?.websiteUrl ? [{ label: "Website", url: profile.websiteUrl, handle: null, icon: "globe" }] : []),
    ...(profile?.contacts ?? []),
  ];
  const education = profile?.education ?? [];
  const experience = profile?.experience ?? [];

  const block = (section: HomepageSection) => {
    switch (section) {
      case "PROFILE": return <Reveal className={styles.introReveal} key={section}><section className={styles.profileSection} id="profile-section" aria-labelledby="intro-heading">
        <div className={styles.profileCopy}>
          <span className={styles.eyebrow}>Profile</span>
          <h1 id="intro-heading"><span className={styles.introGreeting}>Hi, I&apos;m</span> <span className={styles.introName}>{profile?.displayName ?? "Manifold"}.</span></h1>
          <p className={styles.introTagline}><span className={styles.taglineRule}>—</span><em>{profile?.headline ?? "Developer, explorer, and lifelong learner."}</em></p>
          {stats && <p className={styles.introStats}>{stats.articleCount} writings · {stats.thoughtCount} thoughts · {formatWordCount(stats.wordCount)} words</p>}
        </div>
        <div className={styles.profilePortraitWrap}>
          <div className={styles.introPortrait}>{profile?.avatarUrl ? <div role="img" aria-label={`${profile.displayName ?? "Profile"} avatar`} style={{ backgroundImage: `url(${profile.avatarUrl})` }} /> : <span>{initials}</span>}</div>
          {profile?.resumeUrl && <a className={styles.cvLink} href={profile.resumeUrl} download>CV <ArrowUpRight size={12} /></a>}
        </div>
        <div className={styles.introBox}>
          <div className={styles.introBoxHeader}>
            <div className={styles.introBoxTitle}><h2>Introduction</h2></div>
          </div>
          {profile?.organization && <p className={styles.profileOrg}>{profile.organization}</p>}
          <p className={styles.profileBio}>{profile?.bio ?? "I build small, durable tools and keep notes on the questions that sit between software, research, and everyday life. This is where unfinished ideas can stay visible long enough to become useful."}</p>
          {!!profile?.interests?.length && <div className={styles.interestList}>{profile.interests.map((interest) => <span key={interest}>#{interest}</span>)}</div>}
        </div>
      </section></Reveal>;
      case "BACKGROUND": return <Reveal className={styles.sectionReveal} key={section}><section className={styles.backgroundSection} id="background-section" aria-labelledby="background-heading">
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Background</span><h2 id="background-heading">Background</h2></div><span className={styles.sectionHint}>Education and experience</span></div>
        <div className={styles.backgroundSurface} data-background-surface>
          <div className={styles.backgroundColumns}>
            <div className={styles.backgroundColumn}>
              <h3 className={styles.backgroundColumnTitle}>Education</h3>
              {education.length ? education.map((item, itemIndex) => <div className={styles.backgroundItem} key={`${item.institution}-${itemIndex}`}>
                <span className={styles.backgroundPeriod}>{item.period}</span>
                <span className={styles.backgroundItemBody}>
                  <strong>{item.program}</strong>
                  <span>{item.institution}</span>
                </span>
              </div>) : <p className={styles.muted}>Education history will appear here.</p>}
            </div>
            <div className={styles.backgroundColumn}>
              <h3 className={styles.backgroundColumnTitle}>Experience</h3>
              {experience.length ? experience.map((item, itemIndex) => <div className={styles.backgroundItem} key={`${item.organization}-${itemIndex}`}>
                <span className={styles.backgroundPeriod}>{item.period}</span>
                <span className={styles.backgroundItemBody}>
                  <strong>{item.role}</strong>
                  <span>{item.organization}</span>
                </span>
              </div>) : <p className={styles.muted}>Experience will appear here.</p>}
            </div>
          </div>
        </div>
      </section></Reveal>;
      case "RECENT_CONTENT": return <Reveal className={styles.sectionReveal} key={section}><section className={styles.streamSection} id="recent-content-section" aria-labelledby="stream-heading">
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Recent content</span><h2 id="stream-heading">Writings <em>and</em> thoughts</h2></div><span className={styles.sectionHint}>{stats?.contentCount ?? 0} published notes</span></div>
        <div className={styles.contentSurface} data-content-surface>
          <div className={styles.streamColumns}>
            <TimelineColumn title="Writings" icon="✍" href="/writing" items={writings} empty="No writings published yet." />
            <TimelineColumn title="Thoughts" icon="☁" href="/thoughts" items={thoughts} empty="The thought stream is quiet for now." />
          </div>
          {tags.length > 0 && <div className={styles.homeTags}><span className={styles.homeTagsLabel}>Top tags</span>{tags.slice(0, 8).map((tag) => <span className={styles.homeTagPill} key={tag.name}>{tag.name} <small>{tag.count}</small></span>)}</div>}
        </div>
      </section></Reveal>;
      case "UPDATES": return <Reveal className={styles.sectionReveal} key={section}><section className={styles.updateRail} id="updates-section" data-update-rail aria-labelledby="updates-heading">
        <UpdateTimelineView timeline={updateTimeline} hint={stats ? `${stats.contentCount} notes · ${formatWordCount(stats.wordCount)} words` : "Content updates"} />
      </section></Reveal>;
      case "SERIES": return <Reveal className={styles.sectionReveal} key={section}><section className={styles.seriesSection} id="series-section" aria-labelledby="series-heading">
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>My Series</span><h2 id="series-heading">My Series</h2></div><span className={styles.sectionHint}>Services and tools</span></div>
        <SeriesLinks series={profile?.series ?? []} />
        {!(profile?.series?.length) && <p className={styles.muted}>Series will appear here as they take shape.</p>}
      </section></Reveal>;
      case "CONTACT": return <Reveal className={styles.sectionReveal} key={section}><section className={styles.contactSection} id="contact-section" aria-labelledby="contact-heading">
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Contact</span><h2 id="contact-heading">Contact</h2></div><span className={styles.sectionHint}>Public links</span></div>
        <div className={styles.contactPanel} data-contact-panel>
          <ContactLinks contacts={contactLinks} />
          {!contactLinks.length && <p className={styles.muted}>No public links yet.</p>}
        </div>
      </section></Reveal>;
    }
  };

  const anchors = sections.map((section) => ({ id: section, ...sectionMeta[section] }));

  return <main className={styles.page} data-route="home">
    <MinimalMetadata anchors={anchors} />
    <div className={styles.shell}>
      {data.error && <p className={styles.errorBanner}>{data.error}</p>}
      {sections.map((section) => <div key={section} data-home-block={section}>{block(section)}</div>)}
    </div>
  </main>;
}

function TimelineColumn({ title, icon, href, items, empty }: { title: string; icon: string; href: string; items: Content[]; empty: string }) {
  return <div className={styles.timelineColumn}><div className={styles.timelineHeading}><span>{icon} {title}</span><Link href={href} aria-label={`Browse all ${title.toLowerCase()}`}><ArrowUpRight size={14} /></Link></div><div className={styles.timeline}>{items.length ? items.map((item, index) => <Link className={styles.timelineItem} href={buildHref(item)} key={item.id}><span className={styles.timelinePin} data-timeline-pin aria-hidden="true" /><div><div className={styles.timelineItemTop}><span className={styles.timelineNumber}>/{String(index + 1).padStart(2, "0")}</span><div className={styles.timelineItemMeta}><time dateTime={item.publishedAt}>{getRelativeDate(item.publishedAt)}{readingMinutes(item.metadata) ? ` · ${readingMinutes(item.metadata)} min` : ""}</time><span className={styles.timelineStats}>{item.viewCount} views · {item.likeCount} likes{item.commentCount > 0 ? ` · ${item.commentCount} comments` : ""}</span></div></div><h3>{item.title || "Untitled thought"}</h3><p>{item.summary || "A quiet note waiting for its next sentence."}</p></div></Link>) : <p className={styles.muted}>{empty}</p>}</div></div>;
}

function readingMinutes(metadata: unknown) {
  return typeof metadata === "object" && metadata !== null && "readingMinutes" in metadata && typeof metadata.readingMinutes === "number" ? metadata.readingMinutes : undefined;
}
