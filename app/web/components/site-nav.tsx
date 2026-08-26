"use client";

import Link from "next/link";
import { ArrowUpRight, Moon, Rss, Search, Sun, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "../lib/api";
import styles from "../app/site.module.css";

const links = [
  { label: "Home", href: "/" },
  { label: "Writings", href: "/writing" },
  { label: "Thoughts", href: "/thoughts" },
];

type SearchResult = { id: string; href: string; kind: string; title: string | null; summary: string; publishedAt: string | null };

export function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => typeof window !== "undefined" && window.localStorage.getItem("manifold.theme") === "dark" ? "dark" : "light");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [resumeUrl, setResumeUrl] = useState<string | undefined>();
  const [expanded, setExpanded] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onScroll = () => setExpanded(window.scrollY < 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    void createBrowserClient().profile().then((profile) => setResumeUrl(profile.resumeUrl)).catch(() => undefined);
  }, [theme]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    inputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    let active = true;
    if (!searchOpen || query.trim().length < 2) {
      const timer = window.setTimeout(() => { if (active) { setResults([]); setSearching(false); } }, 0);
      return () => { active = false; window.clearTimeout(timer); };
    }
    const timer = window.setTimeout(() => { if (active) setSearching(true); }, 0);
    const searchTimer = window.setTimeout(() => {
      void createBrowserClient().feed({ q: query.trim(), kind: ["ARTICLE", "THOUGHT"], limit: 8 })
        .then((collection) => { if (active) setResults(collection.data); })
        .catch(() => { if (active) setResults([]); })
        .finally(() => { if (active) setSearching(false); });
    }, 220);
    return () => { active = false; window.clearTimeout(timer); window.clearTimeout(searchTimer); };
  }, [query, searchOpen]);

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("manifold.theme", nextTheme);
  };

  const isActive = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);

  return <>
    <header className={`${styles.navbar} ${expanded ? styles.navbarExpanded : styles.navbarCompact}`}>
      <Link className={styles.identity} href="/" aria-label="Return to the home page" onClick={() => { setOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
        <span className={styles.navAvatar}>M</span>
        <span className={styles.identityName}>@manifold</span>
      </Link>
      <button className={styles.menuButton} type="button" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? <X size={18} /> : <span className={styles.menuGlyph}><span /><span /></span>}</button>
      <nav className={`${styles.navLinks} ${open ? styles.navLinksOpen : ""}`} aria-label="Primary navigation">
        <div className={styles.navPills}>
          {links.map((link) => <Link className={`${styles.navPill} ${isActive(link.href) ? styles.navPillActive : ""}`} key={link.href} href={link.href} aria-current={isActive(link.href) ? "page" : undefined} onClick={() => setOpen(false)}>{link.label}</Link>)}
        </div>
        <div className={styles.navUtilities}>
          <button className={styles.utilityButton} type="button" onClick={() => setSearchOpen(true)} aria-label="Search content"><Search size={15} /><kbd>⌘K</kbd></button>
          <button className={styles.utilityButton} type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>{theme === "light" ? <Moon size={15} /> : <Sun size={15} />}</button>
          <a className={styles.utilityButton} href="/feed.xml" aria-label="Subscribe to the RSS feed"><Rss size={15} /></a>
        </div>
      </nav>
    </header>
    {searchOpen && <div className={styles.searchScrim} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSearchOpen(false); }}>
      <section className={styles.searchDialog} role="dialog" aria-modal="true" aria-labelledby="search-title">
        <div className={styles.searchHeader}><span id="search-title">Search content</span><button className={styles.iconButton} type="button" onClick={() => setSearchOpen(false)} aria-label="Close search"><X size={17} /></button></div>
        <label className={styles.searchInputWrap}><Search size={17} /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search writings, thoughts, and the archive" aria-label="Search writings and thoughts" /><kbd>ESC</kbd></label>
        <div className={styles.searchResults} aria-live="polite">
          {searching && <p className={styles.searchHint}>Searching…</p>}
          {!searching && query.trim().length < 2 && <p className={styles.searchHint}>Type at least two characters to search across writings and thoughts.</p>}
          {!searching && query.trim().length >= 2 && results.length === 0 && <p className={styles.searchHint}>No matching notes yet.</p>}
          {results.map((result) => <Link className={styles.searchResult} href={result.href} key={result.id} onClick={() => setSearchOpen(false)}><span className={styles.searchResultMeta}>{result.kind === "ARTICLE" ? "WRITING" : "THOUGHT"}</span><span><strong>{result.title || "Untitled thought"}</strong><small>{result.summary}</small></span><ArrowUpRight size={15} /></Link>)}
          {resumeUrl && <a className={styles.searchResult} href={resumeUrl} download><span className={styles.searchResultMeta}>PROFILE</span><span><strong>Curriculum Vitae</strong><small>Download the current resume</small></span><ArrowUpRight size={15} /></a>}
        </div>
      </section>
    </div>}
  </>;
}
