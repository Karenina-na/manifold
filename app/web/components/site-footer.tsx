"use client";

import { ArrowUpRight, Circle } from "lucide-react";
import { useEffect, useState } from "react";
import { createBrowserClient, getVisitorId } from "../lib/api";
import styles from "../app/site.module.css";

export function SiteFooter() {
  const [activeVisitors, setActiveVisitors] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const visitorId = getVisitorId();
    const heartbeat = () => {
      void createBrowserClient().presence(visitorId)
        .then((status) => { if (active) setActiveVisitors(status.activeVisitors); })
        .catch(() => undefined);
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 60_000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  return <footer className={styles.siteFooter}>
    <div className={styles.siteFooterTop}>
      <span>© 2020–2026</span>
      <span className={styles.footerPowered}>Powered by <strong>Manifold</strong></span>
      <span className={styles.footerPresence} aria-live="polite"><Circle size={7} fill="currentColor" aria-hidden="true" /> {activeVisitors === null ? "Counting readers" : `${activeVisitors} readers online`}</span>
    </div>
    <div className={styles.siteFooterBottom}>
      <span>Built for notes that stay in motion.</span>
      <a href="https://github.com/manifold-space/manifold" target="_blank" rel="noreferrer">Source <ArrowUpRight size={12} /></a>
    </div>
  </footer>;
}
