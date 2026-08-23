"use client";

import Link from "next/link";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { useState } from "react";
import styles from "../app/site.module.css";

const links = [{ label: "Writing", href: "/writing" }, { label: "Projects", href: "/projects" }];

export function SiteNav() {
  const [open, setOpen] = useState(false);
  return <header className={styles.navbar}>
    <Link className={styles.wordmark} href="/" onClick={() => setOpen(false)}>manifold<span>.</span></Link>
    <button className={styles.menuButton} type="button" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? <X size={18} /> : <Menu size={18} />}</button>
    <nav className={`${styles.navLinks} ${open ? styles.navLinksOpen : ""}`}>
      {links.map((link) => <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</Link>)}
      <a href="https://github.com/manifold-space/manifold" target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={14} /></a>
    </nav>
  </header>;
}
