"use client";

import Link from "next/link";
import { ArrowUpRight, Check, Languages, Moon, Rss, Search, Sun, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { buildHref, createBrowserClient } from "../../lib/api";
import { useModalFocus } from "../ui/use-modal-focus";
import { useTheme } from "./theme-provider";
import { useLocale } from "./i18n-provider";
import type { Locale } from "../../i18n/locale";
import type { SiteNavigationItem } from "@manifold/contracts";
import styles from "../../app/site.module.css";

type SearchResult = { id: string; href: string; kind: string; title: string | null | undefined; summary: string; publishedAt: string | null };

export function SiteNav({ navigation }: { navigation?: SiteNavigationItem[] }) {
  const { locale, setLocale, t } = useLocale();
  const defaultLinks: SiteNavigationItem[] = [
    { label: t("nav.home"), href: "/" },
    { label: t("nav.writings"), href: "/writing" },
    { label: t("nav.thoughts"), href: "/thoughts" },
    { label: t("nav.chain"), href: "/chain" },
  ];
  const links = navigation?.length ? navigation : defaultLinks;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const languageRef = useRef<HTMLDivElement>(null);
  const { theme, toggleTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [resumeUrl, setResumeUrl] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchDialogRef = useRef<HTMLElement>(null);

  // Declared before the effect that focuses the input so the search button is
  // captured as the opener while it is still the active element.
  useModalFocus(searchOpen, searchDialogRef);

  useEffect(() => {
    const onScroll = () => setExpanded(window.scrollY < 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    void createBrowserClient().profile().then((profile) => setResumeUrl(profile.resumeUrl)).catch(() => undefined);
  }, []);

  // Route hue identity: keep the document root in sync with the active route so
  // chrome outside the page <main> (nav pill, search, footer) shares the hue.
  useEffect(() => {
    document.documentElement.dataset.route = pathname.startsWith("/writing") ? "writing" : pathname.startsWith("/thoughts") ? "thought" : pathname.startsWith("/chain") ? "chain" : "home";
  }, [pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setLanguageOpen(false);
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!languageOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!languageRef.current?.contains(event.target as Node)) setLanguageOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [languageOpen]);

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
      void createBrowserClient().content({ q: query.trim(), kind: ["ARTICLE", "THOUGHT"], pageSize: 8 })
        .then((collection) => { if (active) setResults(collection.data.map((item) => ({ id: item.id, href: buildHref(item), kind: item.kind, title: item.title, summary: item.summary, publishedAt: item.publishedAt }))); })
        .catch(() => { if (active) setResults([]); })
        .finally(() => { if (active) setSearching(false); });
    }, 220);
    return () => { active = false; window.clearTimeout(timer); window.clearTimeout(searchTimer); };
  }, [query, searchOpen]);

  const isActive = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);

  return <>
    <header className={`${styles.navbar} ${expanded ? styles.navbarExpanded : styles.navbarCompact}`}>
      <Link className={styles.identity} href="/" aria-label={t("nav.returnHome")} onClick={() => { setOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
        <span className={styles.navAvatar}>M</span>
        <span className={styles.identityName}>@manifold</span>
      </Link>
      <button className={styles.menuButton} type="button" aria-label={open ? t("nav.close") : t("nav.open")} aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? <X size={18} /> : <span className={styles.menuGlyph}><span /><span /></span>}</button>
      <nav className={`${styles.navLinks} ${open ? styles.navLinksOpen : ""}`} aria-label={t("nav.primary")}>
        <div className={styles.navPills}>
          {links.map((link) => link.external
            ? <a className={styles.navPill} key={link.href} href={link.href} target="_blank" rel="noreferrer">{link.label}</a>
            : <Link className={`${styles.navPill} ${isActive(link.href) ? styles.navPillActive : ""}`} key={link.href} href={link.href} aria-current={isActive(link.href) ? "page" : undefined} onClick={() => setOpen(false)}>{link.label}</Link>)}
        </div>
        <div className={styles.navUtilities}>
          <button className={styles.utilityButton} type="button" onClick={() => setSearchOpen(true)} aria-label={t("nav.search")}><Search size={15} /><kbd>⌘K</kbd></button>
          <div className={styles.languageMenu} ref={languageRef}>
            <button className={styles.utilityButton} type="button" onClick={() => setLanguageOpen((value) => !value)} aria-label={t("locale.switch")} aria-haspopup="menu" aria-expanded={languageOpen}><Languages size={15} /></button>
            {languageOpen && <div className={styles.languageOptions} role="menu" aria-label={t("locale.menu")}>
              {(["en", "zh-CN"] as Locale[]).map((option) => <button key={option} type="button" role="menuitemradio" aria-checked={locale === option} onClick={() => { void setLocale(option); setLanguageOpen(false); }}><span>{option === "en" ? t("locale.english") : t("locale.chinese")}</span>{locale === option && <Check size={13} aria-hidden="true" />}</button>)}
            </div>}
          </div>
          <button className={styles.utilityButton} type="button" onClick={toggleTheme} aria-label={theme === "light" ? t("nav.themeDark") : t("nav.themeLight")}>{theme === "light" ? <Moon size={15} /> : <Sun size={15} />}</button>
          <a className={styles.utilityButton} href="/feed.xml" aria-label={t("nav.rss")}><Rss size={15} /></a>
        </div>
      </nav>
    </header>
    {searchOpen && <div className={styles.searchScrim} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSearchOpen(false); }}>
      <section ref={searchDialogRef} className={styles.searchDialog} role="dialog" aria-modal="true" aria-labelledby="search-title">
        <div className={styles.searchHeader}><span id="search-title">{t("search.title")}</span><button className={styles.iconButton} type="button" onClick={() => setSearchOpen(false)} aria-label={t("search.close")}><X size={17} /></button></div>
        <label className={styles.searchInputWrap}><Search size={17} /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("search.placeholder")} aria-label={t("search.label")} /><kbd>ESC</kbd></label>
        <div className={styles.searchResults} aria-live="polite">
          {searching && <p className={styles.searchHint}>{t("search.searching")}</p>}
          {!searching && query.trim().length < 2 && <p className={styles.searchHint}>{t("search.minimum")}</p>}
          {!searching && query.trim().length >= 2 && results.length === 0 && <p className={styles.searchHint}>{t("search.empty")}</p>}
          {results.map((result) => <Link className={styles.searchResult} href={result.href} key={result.id} onClick={() => setSearchOpen(false)}><span className={styles.searchResultMeta}>{result.kind === "ARTICLE" ? t("common.writing").toUpperCase() : t("common.thought").toUpperCase()}</span><span><strong>{result.title || t("search.untitledThought")}</strong><small>{result.summary}</small></span><ArrowUpRight size={15} /></Link>)}
          {resumeUrl && <a className={styles.searchResult} href={resumeUrl} download><span className={styles.searchResultMeta}>{t("search.profile")}</span><span><strong>{t("search.cv")}</strong><small>{t("search.cvDescription")}</small></span><ArrowUpRight size={15} /></a>}
        </div>
      </section>
    </div>}
  </>;
}
