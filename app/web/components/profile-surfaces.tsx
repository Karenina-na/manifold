"use client";

import { AtSign, Flame, Globe2, Mail, MessageCircle, Podcast, Radio, Rss, Send, Tv, X, GitBranch, ExternalLink } from "lucide-react";
import type { ProfileContact, ProfileSeriesItem } from "@manifold/contracts";
import { useId, useRef, useState } from "react";
import { FloatingTooltip } from "./floating-tooltip";
import styles from "../app/site.module.css";

function contactIcon(contact: ProfileContact) {
  const icon = contact.icon?.toLowerCase().trim() ?? "";
  const label = contact.label.toLowerCase();
  const url = contact.url.toLowerCase();
  if (icon === "x" || icon === "twitter" || label === "x" || label.includes("twitter")) return <X size={22} strokeWidth={1.7} />;
  if (icon === "rss" || label.includes("rss") || url.endsWith("/feed.xml")) return <Rss size={22} strokeWidth={1.7} />;
  if (icon === "mail" || label.includes("mail") || label.includes("email")) return <Mail size={22} strokeWidth={1.7} />;
  if (icon === "github" || label.includes("github") || url.includes("github")) return <GitBranch size={22} strokeWidth={1.7} />;
  if (icon === "flame" || label.includes("flame") || label.includes("bilibili")) return <Flame size={22} strokeWidth={1.7} />;
  if (icon === "tv" || label.includes("youtube") || label.includes("tv")) return <Tv size={22} strokeWidth={1.7} />;
  if (icon === "telegram" || label.includes("telegram")) return <Send size={22} strokeWidth={1.7} />;
  if (icon === "podcast" || label.includes("podcast")) return <Podcast size={22} strokeWidth={1.7} />;
  if (icon === "message" || label.includes("whats") || label.includes("message")) return <MessageCircle size={22} strokeWidth={1.7} />;
  if (icon === "at" || label.includes("handle")) return <AtSign size={22} strokeWidth={1.7} />;
  if (icon === "radio") return <Radio size={22} strokeWidth={1.7} />;
  return <Globe2 size={22} strokeWidth={1.7} />;
}

function TooltipLink({ href, label, description, children, external = false, tooltipPlacement = "top" }: { href: string; label: string; description: string; children: React.ReactNode; external?: boolean; tooltipPlacement?: "top" | "bottom" }) {
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  return <span className={styles.tooltipAnchor} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
    <a ref={anchorRef} className={styles.contactItem} data-contact-item href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} aria-label={label} aria-describedby={tooltipId}>
      {children}
    </a>
    <FloatingTooltip anchorRef={anchorRef} open={open} placement={tooltipPlacement} dataAttribute="data-contact-tooltip" id={tooltipId}>
      <span className={styles.tooltipMeta}>CONTACT</span>
      <strong>{label}</strong>
      <span>{description}</span>
    </FloatingTooltip>
  </span>;
}

export function ContactLinks({ contacts }: { contacts: ProfileContact[] }) {
  return <div className={styles.contactGrid} data-contact-grid>
    {contacts.map((contact) => <TooltipLink key={contact.url} href={contact.url} label={contact.label} description={contact.handle ?? contact.url.replace(/^https?:\/\//, "")} external={contact.url.startsWith("http")}>
      <span className={styles.contactIcon} aria-hidden="true">{contactIcon(contact)}</span>
    </TooltipLink>)}
  </div>;
}

export function SeriesLinks({ series }: { series: ProfileSeriesItem[] }) {
  return <div className={styles.seriesGrid} data-series-grid>
    {series.map((item, index) => <SeriesLink key={item.url} item={item} index={index} />)}
  </div>;
}

function SeriesLink({ item, index }: { item: ProfileSeriesItem; index: number }) {
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  return <span className={styles.seriesTooltipAnchor} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
    <a ref={anchorRef} className={styles.seriesCard} data-series-card href={item.url} target="_blank" rel="noreferrer" aria-label={`${item.name}: ${item.description}`} aria-describedby={tooltipId}>
      <span className={styles.seriesCardTop}><span className={styles.seriesIdentity}><span className={styles.seriesIndex}>0{index + 1}</span><span className={styles.seriesIcon}><Globe2 size={15} /></span></span><ExternalLink size={14} aria-hidden="true" /></span>
      <span className={styles.seriesCardBody}><span className={styles.seriesCategory}>{item.category ?? "Series"}</span><h3>{item.name}</h3></span>
    </a>
    <FloatingTooltip anchorRef={anchorRef} open={open} placement="bottom" dataAttribute="data-series-tooltip" id={tooltipId}>
      <span className={styles.tooltipMeta}>{item.category ?? "Series"}</span>
      <strong>{item.name}</strong>
      <span className={styles.tooltipDescription}>{item.description}</span>
      <span className={styles.tooltipUrl}>{item.url}</span>
    </FloatingTooltip>
  </span>;
}
