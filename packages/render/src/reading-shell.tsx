"use client";

// Single source for the public reading surface, shared by app/web and
// app/admin. Changes here or in render.css must be verified against BOTH
// surfaces — see packages/render/README.md before diverging.
import { useEffect, useRef, useState, type ReactNode } from "react";

export type RenderTocItem = { id: string; label: string; level: 2 | 3 };

export function ArticleToc({ items }: { items: RenderTocItem[] }) {
  const [activeId, setActiveId] = useState(items[0]?.id ?? "");
  const [progress, setProgress] = useState(0);
  const activeIdRef = useRef(items[0]?.id ?? "");
  useEffect(() => {
    const headings = Array.from(document.querySelectorAll<HTMLElement>("[data-content-heading]"));
    const update = () => {
      const threshold = 170;
      const current = headings.reduce((selected, heading) => heading.getBoundingClientRect().top <= threshold ? heading.id : selected, "");
      const nextId = current || items[0]?.id || "";
      if (nextId !== activeIdRef.current) {
        activeIdRef.current = nextId;
        setActiveId(nextId);
      }
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [items]);
  return <aside className="articleToc" aria-label="On this page">
    <div className="articleTocHeading"><span>On this page</span><span>{Math.round(progress * 100)}%</span></div>
    <div className="articleTocTrack" aria-hidden="true"><span style={{ height: `${progress * 100}%` }} /></div>
    <nav>{items.map((item) => <a key={item.id} href={`#${item.id}`} className={`${item.level === 3 ? "tocNested" : ""} ${activeId === item.id ? "articleTocActive" : ""}`} aria-current={activeId === item.id ? "location" : undefined}>{item.label}</a>)}</nav>
  </aside>;
}

export function ReadingProgress({ label = "Reading" }: { label?: string }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return <aside className="articleToc" aria-label="Reading progress">
    <div className="articleTocHeading"><span>{label}</span><span>{Math.round(progress * 100)}%</span></div>
    <div className="articleTocTrack" aria-hidden="true"><span style={{ height: `${progress * 100}%` }} /></div>
  </aside>;
}

// Grid skeleton for the long-form reading surface. Web passes its comment
// orchestration through the slots; admin renders the same shell without them.
// Without a rail slot the grid drops the reserved rail column ("no-rail").
export function ReadingShell({ rail, children, toc, discussion, discussionTrigger, composer, endAction, endSlot }: { rail?: ReactNode; children: ReactNode; toc?: RenderTocItem[]; discussion?: ReactNode; discussionTrigger?: ReactNode; composer?: ReactNode; endAction?: ReactNode; endSlot?: ReactNode }) {
  return <div className={rail == null ? "articleReadingShell no-rail" : "articleReadingShell"}>
    {rail}
    <div className="articleReadingMain">{children}</div>
    {toc && toc.length > 0 && <ArticleToc items={toc} />}
    {endAction}
    {endSlot}
    {discussion && <section className="articleDiscussionBlock" aria-label="Article discussion">{discussion}{discussionTrigger}</section>}
    {composer}
  </div>;
}
