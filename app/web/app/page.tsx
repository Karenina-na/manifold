import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { buildHref, loadHomeData } from "../lib/api";
import { buildUpdateTimeline } from "../features/home/update-timeline";
import { Reveal } from "../components/ui/reveal";
import { UpdateTimelineView } from "../features/home/update-timeline-view";
import { MinimalMetadata } from "../features/home/minimal-metadata";
import { ContactLinks, SeriesLinks } from "../features/home/profile-surfaces";
import type { Content, HomepageSection } from "@manifold/contracts";
import type { TFunction } from "i18next";
import { getServerI18n } from "../i18n/i18n-server";
import type { Locale } from "../i18n/locale";
import styles from "./site.module.css";

export const dynamic = "force-dynamic";

const defaultSections: HomepageSection[] = ["PROFILE", "BACKGROUND", "RECENT_CONTENT", "UPDATES", "SERIES", "CONTACT"];

function formatWordCount(count: number, locale: Locale) {
  return new Intl.NumberFormat(locale).format(count);
}

function getRelativeDate(value: string | null | undefined, locale: Locale, t: TFunction) {
  if (!value) return t("common.undated");
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 86_400_000));
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day");
}

export default async function Home() {
  const [data, { locale, t }] = await Promise.all([loadHomeData(), getServerI18n()]);
  const sectionMeta: Record<HomepageSection, { label: string; target: string; preview: string }> = {
    PROFILE: { label: t("common.profile"), target: "profile-section", preview: t("home.profile.preview") },
    BACKGROUND: { label: t("common.background"), target: "background-section", preview: t("home.background.preview") },
    RECENT_CONTENT: { label: t("home.recent"), target: "recent-content-section", preview: t("home.recent.preview") },
    UPDATES: { label: t("common.updates"), target: "updates-section", preview: t("home.updates.preview") },
    SERIES: { label: t("home.mySeries"), target: "series-section", preview: t("home.series.preview") },
    CONTACT: { label: t("common.contact"), target: "contact-section", preview: t("home.contact.preview") },
  };
  const profile = data.profile;
  const sections = data.site?.sections?.length ? data.site.sections : defaultSections;
  const stats = data.stats;
  const tags = data.tags ?? [];
  const writings = data.feed?.filter((item) => item.kind === "ARTICLE").slice(0, 3) ?? [];
  const thoughts = data.feed?.filter((item) => item.kind === "THOUGHT").slice(0, 3) ?? [];
  const initials = profile?.displayName?.slice(0, 1).toUpperCase() ?? "M";
  const updateTimeline = buildUpdateTimeline(data.timeline, {
    title: t("search.untitledThought"),
    summary: t("home.timelineFallback"),
  });
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
          <h1 id="intro-heading"><span className={styles.introGreeting}>{t("home.greeting")}</span> <span className={styles.introName}>{profile?.displayName ?? "Manifold"}.</span></h1>
          <p className={styles.introTagline}><span className={styles.taglineRule}>—</span><em>{profile?.headline ?? t("home.fallbackHeadline")}</em></p>
          {stats && <p className={styles.introStats}>{t("home.stats", { articles: stats.articleCount, thoughts: stats.thoughtCount, words: formatWordCount(stats.wordCount, locale) })}</p>}
        </div>
        <div className={styles.profilePortraitWrap}>
          <div className={styles.introPortrait}>{profile?.avatarUrl ? <div role="img" aria-label={t("home.avatar", { name: profile.displayName ?? t("common.profile") })} style={{ backgroundImage: `url(${profile.avatarUrl})` }} /> : <span>{initials}</span>}</div>
          {profile?.resumeUrl && <a className={styles.cvLink} href={profile.resumeUrl} download>CV <ArrowUpRight size={12} /></a>}
        </div>
        <div className={styles.introBox}>
          <div className={styles.introBoxHeader}>
            <div className={styles.introBoxTitle}><h2>{t("home.introduction")}</h2></div>
          </div>
          {profile?.organization && <p className={styles.profileOrg}>{profile.organization}</p>}
          <p className={styles.profileBio}>{profile?.bio ?? t("home.fallbackBio")}</p>
          {!!profile?.interests?.length && <div className={styles.interestList}>{profile.interests.map((interest) => <span key={interest}>#{interest}</span>)}</div>}
        </div>
      </section></Reveal>;
      case "BACKGROUND": return <Reveal className={styles.sectionReveal} key={section}><section className={styles.backgroundSection} id="background-section" aria-labelledby="background-heading">
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Background</span><h2 id="background-heading">{t("common.background")}</h2></div><span className={styles.sectionHint}>{t("home.background.preview")}</span></div>
        <div className={styles.backgroundSurface} data-background-surface>
          <div className={styles.backgroundColumns}>
            <div className={styles.backgroundColumn}>
              <h3 className={styles.backgroundColumnTitle}>{t("home.education")}</h3>
              {education.length ? education.map((item, itemIndex) => <div className={styles.backgroundItem} key={`${item.institution}-${itemIndex}`}>
                <span className={styles.backgroundPeriod}>{item.period}</span>
                <span className={styles.backgroundItemBody}>
                  <strong>{item.program}</strong>
                  <span>{item.institution}</span>
                </span>
              </div>) : <p className={styles.muted}>{t("home.educationEmpty")}</p>}
            </div>
            <div className={styles.backgroundColumn}>
              <h3 className={styles.backgroundColumnTitle}>{t("home.experience")}</h3>
              {experience.length ? experience.map((item, itemIndex) => <div className={styles.backgroundItem} key={`${item.organization}-${itemIndex}`}>
                <span className={styles.backgroundPeriod}>{item.period}</span>
                <span className={styles.backgroundItemBody}>
                  <strong>{item.role}</strong>
                  <span>{item.organization}</span>
                </span>
              </div>) : <p className={styles.muted}>{t("home.experienceEmpty")}</p>}
            </div>
          </div>
        </div>
      </section></Reveal>;
      case "RECENT_CONTENT": return <Reveal className={styles.sectionReveal} key={section}><section className={styles.streamSection} id="recent-content-section" aria-labelledby="stream-heading">
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Recent content</span><h2 id="stream-heading">{t("home.recentTitle")}</h2></div><span className={styles.sectionHint}>{t("common.publishedNotes", { count: stats?.contentCount ?? 0 })}</span></div>
        <div className={styles.contentSurface} data-content-surface>
          <div className={styles.streamColumns}>
            <TimelineColumn title={t("common.writings")} icon="✍" href="/writing" items={writings} empty={t("home.writingsEmpty")} locale={locale} t={t} />
            <TimelineColumn title={t("common.thoughts")} icon="☁" href="/thoughts" items={thoughts} empty={t("home.thoughtsEmpty")} locale={locale} t={t} />
          </div>
          {tags.length > 0 && <div className={styles.homeTags}><span className={styles.homeTagsLabel}>{t("home.topTags")}</span>{tags.slice(0, 8).map((tag) => <span className={styles.homeTagPill} key={tag.name}>{tag.name} <small>{tag.count}</small></span>)}</div>}
        </div>
      </section></Reveal>;
      case "UPDATES": return <Reveal className={styles.sectionReveal} key={section}><section className={styles.updateRail} id="updates-section" data-update-rail aria-labelledby="updates-heading">
        <UpdateTimelineView timeline={updateTimeline} hint={stats ? `${t("common.notes", { count: stats.contentCount })} · ${t("common.words", { count: stats.wordCount })}` : t("home.contentUpdates")} />
      </section></Reveal>;
      case "SERIES": return <Reveal className={styles.sectionReveal} key={section}><section className={styles.seriesSection} id="series-section" aria-labelledby="series-heading">
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>My Series</span><h2 id="series-heading">{t("home.mySeries")}</h2></div><span className={styles.sectionHint}>{t("home.series.preview")}</span></div>
        <SeriesLinks series={profile?.series ?? []} />
        {!(profile?.series?.length) && <p className={styles.muted}>{t("home.seriesEmpty")}</p>}
      </section></Reveal>;
      case "CONTACT": return <Reveal className={styles.sectionReveal} key={section}><section className={styles.contactSection} id="contact-section" aria-labelledby="contact-heading">
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Contact</span><h2 id="contact-heading">{t("common.contact")}</h2></div><span className={styles.sectionHint}>{t("home.publicLinks")}</span></div>
        <div className={styles.contactPanel} data-contact-panel>
          <ContactLinks contacts={contactLinks} />
          {!contactLinks.length && <p className={styles.muted}>{t("home.linksEmpty")}</p>}
        </div>
      </section></Reveal>;
    }
  };

  const anchors = sections.map((section) => ({ id: section, ...sectionMeta[section] }));

  return <main className={styles.page} data-route="home">
    <MinimalMetadata anchors={anchors} />
    <div className={styles.shell}>
      {data.error && <p className={styles.errorBanner}>{t("home.coreUnavailable")}</p>}
      {sections.map((section) => <div key={section} data-home-block={section}>{block(section)}</div>)}
    </div>
  </main>;
}

function TimelineColumn({ title, icon, href, items, empty, locale, t }: { title: string; icon: string; href: string; items: Content[]; empty: string; locale: Locale; t: TFunction }) {
  return <div className={styles.timelineColumn}><div className={styles.timelineHeading}><span>{icon} {title}</span><Link href={href} aria-label={t("common.browseAll", { name: title })}><ArrowUpRight size={14} /></Link></div><div className={styles.timeline}>{items.length ? items.map((item, index) => <Link className={styles.timelineItem} href={buildHref(item)} key={item.id}><span className={styles.timelinePin} data-timeline-pin aria-hidden="true" /><div><div className={styles.timelineItemTop}><span className={styles.timelineNumber}>/{String(index + 1).padStart(2, "0")}</span><div className={styles.timelineItemMeta}><time dateTime={item.publishedAt}>{getRelativeDate(item.publishedAt, locale, t)}{readingMinutes(item.metadata) ? ` · ${t("common.minRead", { count: readingMinutes(item.metadata) })}` : ""}</time><span className={styles.timelineStats}>{t("home.timelineMeta", { views: item.viewCount, likes: item.likeCount, comments: item.commentCount > 0 ? t("home.commentsSuffix", { count: item.commentCount }) : "" })}</span></div></div><h3>{item.title || t("search.untitledThought")}</h3><p>{item.summary || t("home.timelineFallback")}</p></div></Link>) : <p className={styles.muted}>{empty}</p>}</div></div>;
}

function readingMinutes(metadata: unknown) {
  return typeof metadata === "object" && metadata !== null && "readingMinutes" in metadata && typeof metadata.readingMinutes === "number" ? metadata.readingMinutes : undefined;
}
