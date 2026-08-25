import Link from "next/link";
import { ArrowUpRight, ExternalLink, Globe2, Mail, MessageCircle, Send } from "lucide-react";
import { loadHomeData, formatDate } from "../lib/api";
import { buildUpdateTimeline } from "../lib/update-timeline";
import { Reveal } from "../components/reveal";
import { UpdateTimelineView } from "../components/update-timeline";
import { MinimalMetadata } from "../components/minimal-metadata";
import styles from "./site.module.css";

export const dynamic = "force-dynamic";

function getDate(value: string | null | undefined) {
  return value ? formatDate(value) : "Undated";
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
  const writings = data.feed?.filter((item) => item.kind === "ARTICLE").slice(0, 3) ?? [];
  const thoughts = data.feed?.filter((item) => item.kind === "THOUGHT").slice(0, 3) ?? [];
  const initials = profile?.displayName?.slice(0, 1).toUpperCase() ?? "M";
  const updateTimeline = buildUpdateTimeline(data.feed ?? []);

  return <main className={styles.page}>
    <MinimalMetadata />
    <div className={styles.shell}>
      {data.error && <p className={styles.errorBanner}>{data.error}</p>}
      <Reveal className={styles.introReveal}><section className={styles.profileSection} id="profile-section" aria-labelledby="intro-heading">
        <div className={styles.profileCopy}>
          <span className={styles.eyebrow}>Profile <span className={styles.eyebrowIndex}>/ 01</span></span>
          <h1 id="intro-heading"><span className={styles.introGreeting}>Hi, I&apos;m</span> <span className={styles.introName}>{profile?.displayName ?? "Manifold"}.</span></h1>
          <p className={styles.introTagline}><span className={styles.taglineRule}>—</span><em>{profile?.headline ?? "Developer, explorer, and lifelong learner."}</em></p>
          <div className={styles.introBox}>
            <div className={styles.introBoxHeader}>
              <div className={styles.introBoxTitle}><span className={styles.sectionIndex}>01</span><h2>Introduction</h2></div>
              {data.now?.mood && <span className={styles.statusBadge}><span className={styles.statusDot} />{data.now.mood}</span>}
            </div>
            <p className={styles.profileBio}>{profile?.bio ?? "I build small, durable tools and keep notes on the questions that sit between software, research, and everyday life. This is where unfinished ideas can stay visible long enough to become useful."}</p>
            {!!profile?.interests?.length && <div className={styles.interestList}>{profile.interests.map((interest) => <span key={interest}>#{interest}</span>)}</div>}
          </div>
        </div>
        <div className={styles.profilePortraitWrap}>
          <div className={styles.introPortrait}>{profile?.avatarUrl ? <div role="img" aria-label={`${profile.displayName ?? "Profile"} avatar`} style={{ backgroundImage: `url(${profile.avatarUrl})` }} /> : <span>{initials}</span>}</div>
          {profile?.resumeUrl && <a className={styles.cvLink} href={profile.resumeUrl} download>CV <ArrowUpRight size={12} /></a>}
        </div>
      </section></Reveal>
      <SceneBreak />

      <Reveal className={styles.sectionReveal}><section className={styles.streamSection} id="recent-content-section" aria-labelledby="stream-heading">
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>✦ Recent content <span className={styles.eyebrowIndex}>/ 02</span></span><h2 id="stream-heading">Writings <em>and</em> thoughts</h2></div><span className={styles.sectionHint}>{data.stats?.contentCount ?? 0} published notes</span></div>
        <div className={styles.contentSurface} data-content-surface>
          <div className={styles.streamColumns}>
            <TimelineColumn title="Writings" icon="✍" href="/writing" items={writings} empty="No writings published yet." />
            <TimelineColumn title="Thoughts" icon="☁" href="/thoughts" items={thoughts} empty="The thought stream is quiet for now." />
          </div>
        </div>
      </section></Reveal>
      <SceneBreak />

      <Reveal className={styles.sectionReveal}><section className={styles.updateRail} id="updates-section" data-update-rail aria-labelledby="updates-heading">
        <div className={styles.updateRailHeader}><div><span className={styles.eyebrow}>↗ Updates <span className={styles.eyebrowIndex}>/ 03</span></span><h2 id="updates-heading" className={styles.updateTitle}>A small record of what moved</h2></div><span className={styles.sectionHint}>Last 10 content updates</span></div>
        <UpdateTimelineView timeline={updateTimeline} />
      </section></Reveal>
      <SceneBreak />

      <Reveal className={styles.sectionReveal}><section className={styles.seriesSection} id="series-section" aria-labelledby="series-heading">
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>◈ My Series <span className={styles.eyebrowIndex}>/ 04</span></span><h2 id="series-heading">My Series</h2></div><span className={styles.sectionHint}>Services and tools</span></div>
        <div className={styles.seriesGrid}>{(profile?.series ?? []).map((series, index) => <a className={styles.seriesCard} data-series-card href={series.url} key={series.url} target="_blank" rel="noreferrer" aria-describedby={`series-tooltip-${index}`}>
          <div className={styles.seriesCardTop}><span className={styles.seriesIdentity}><span className={styles.seriesIndex}>0{index + 1}</span><span className={styles.seriesIcon}><Globe2 size={15} /></span></span><ExternalLink size={14} aria-hidden="true" /></div>
          <div className={styles.seriesCardBody}><span className={styles.seriesCategory}>{series.category ?? "Series"}</span><h3>{series.name}</h3></div>
          <span className={styles.seriesTooltip} id={`series-tooltip-${index}`} data-series-tooltip role="tooltip"><span className={styles.tooltipMeta}>{series.category ?? "Series"}</span><strong>{series.name}</strong><span className={styles.tooltipDescription}>{series.description}</span><span className={styles.tooltipUrl}>{series.url}</span></span>
        </a>)}</div>
        {!(profile?.series?.length) && <p className={styles.muted}>Series will appear here as they take shape.</p>}
      </section></Reveal>
      <SceneBreak />

      <Reveal className={styles.sectionReveal}><section className={styles.contactSection} id="contact-section" aria-labelledby="contact-heading">
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>↘ Contact <span className={styles.eyebrowIndex}>/ 05</span></span><h2 id="contact-heading">Contact</h2></div><span className={styles.sectionHint}>Public links</span></div>
        <div className={styles.contactPanel} data-contact-panel><div className={styles.contactGrid}>{(profile?.contacts ?? []).map((contact, index) => <a className={styles.contactItem} data-contact-item href={contact.url} key={contact.url} target={contact.url.startsWith("http") ? "_blank" : undefined} rel={contact.url.startsWith("http") ? "noreferrer" : undefined} aria-describedby={`contact-tooltip-${index}`} aria-label={`${contact.label}: ${contact.handle ?? contact.url}`}>
          <span className={styles.contactIcon} aria-hidden="true">{contact.label.toLowerCase().includes("mail") ? <Mail size={15} /> : contact.label.toLowerCase().includes("whats") ? <MessageCircle size={15} /> : <Send size={15} />}</span>
          <span className={styles.contactTooltip} id={`contact-tooltip-${index}`} data-contact-tooltip role="tooltip"><strong>{contact.label}</strong><span>{contact.handle ?? contact.url.replace(/^https?:\/\//, "")}</span><small>{contact.url}</small></span>
        </a>)}</div>{!(profile?.contacts?.length) && <p className={styles.muted}>Public contact links will appear here.</p>}</div>
      </section></Reveal>

    </div>
  </main>;
}

function TimelineColumn({ title, icon, href, items, empty }: { title: string; icon: string; href: string; items: Array<{ id: string; href: string; title: string | null; summary: string; body?: string; publishedAt: string | null; createdAt: string; metadata: unknown }>; empty: string }) {
  return <div className={styles.timelineColumn}><div className={styles.timelineHeading}><span>{icon} {title}</span><Link href={href} aria-label={`Browse all ${title.toLowerCase()}`}><ArrowUpRight size={14} /></Link></div><div className={styles.timeline}>{items.length ? items.map((item, index) => <Link className={styles.timelineItem} href={item.href} key={item.id}><span className={styles.timelinePin} data-timeline-pin aria-hidden="true" /><div><div className={styles.timelineItemTop}><span className={styles.timelineNumber}>/{String(index + 1).padStart(2, "0")}</span><time dateTime={item.publishedAt ?? item.createdAt}>{getRelativeDate(item.publishedAt ?? item.createdAt)} · {getDate(item.publishedAt ?? item.createdAt)}{readingMinutes(item.metadata) ? ` · ${readingMinutes(item.metadata)} min` : ""}</time></div><h3>{item.title || "Untitled thought"}</h3><p>{item.summary || item.body || "A quiet note waiting for its next sentence."}</p></div></Link>) : <p className={styles.muted}>{empty}</p>}</div></div>;
}

function SceneBreak() {
  return <div className={styles.sceneBreak} data-scene-break aria-hidden="true"><span className={styles.sceneBreakLine} /><span className={styles.sceneBreakNode} /><span className={styles.sceneBreakLine} /></div>;
}

function readingMinutes(metadata: unknown) {
  return typeof metadata === "object" && metadata !== null && "readingMinutes" in metadata && typeof metadata.readingMinutes === "number" ? metadata.readingMinutes : undefined;
}
