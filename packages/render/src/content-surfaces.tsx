"use client";

// Single source for the public article/thought detail surfaces, shared by
// app/web and app/admin. Changes here or in render.css must be verified
// against BOTH surfaces — see packages/render/README.md before diverging.
import { BookOpen, CalendarDays, Compass, Sparkles, Tag } from "lucide-react";
import type { ReactNode } from "react";
import { MarkdownContent } from "./markdown-content";
import { ReadingProgress, ReadingShell, type RenderTocItem } from "./reading-shell";

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", year: "numeric" }).format(new Date(iso));
}

export function ThoughtHeader({ title, summary, date, mood, tags, actions, question, context, source }: { title: string; summary?: string | null; date: string; mood?: string | null; tags: string[]; actions?: ReactNode; question?: string | null; context?: string | null; source?: string | null }) {
  return <header className="articleHeader">
    <span className="eyebrow">Thought</span>
    <h1>{title || "A thought"}</h1>
    {summary && <p className="thoughtSummary"><span aria-hidden="true">✦</span>{summary}</p>}
    <div className="articleMeta" aria-label="Thought metadata">
      <span><CalendarDays size={14} aria-hidden="true" /> <time dateTime={date}>{formatDate(date)}</time></span>
      {mood && <span className="thoughtMood"><Sparkles size={14} aria-hidden="true" /> {mood}</span>}
      {tags.map((tag) => <span key={tag}><Tag size={14} aria-hidden="true" /> {tag}</span>)}
    </div>
    {actions}
    {question && <blockquote className="thoughtReflection">{question}</blockquote>}
    {(context || source) && <div className="thoughtProvenance">
      {context && <span><Compass size={14} aria-hidden="true" /> {context}</span>}
      {source && <span><BookOpen size={14} aria-hidden="true" /> {source}</span>}
    </div>}
  </header>;
}

export function ThoughtBody({ body }: { body: string }) {
  return <div className="articleBodyBlock">
    <div className="markdown"><MarkdownContent content={body} hideFirstH1 /></div>
  </div>;
}

type ThoughtSurfaceProps = {
  title: string;
  summary?: string | null;
  date: string;
  mood?: string | null;
  tags: string[];
  question?: string | null;
  context?: string | null;
  source?: string | null;
  body: string;
  progress?: boolean;
  actions?: ReactNode;
};

export function ThoughtSurface({ title, summary, date, mood, tags, question, context, source, body, progress = false, actions }: ThoughtSurfaceProps) {
  return <div className="thoughtReadingArea">
    <section className="articleTitleBlock">
      <ThoughtHeader title={title} summary={summary} date={date} mood={mood} tags={tags} actions={actions} question={question} context={context} source={source} />
    </section>
    {progress && <div className="thoughtProgressRail"><ReadingProgress /></div>}
    <ThoughtBody body={body} />
  </div>;
}

type ArticleSurfaceProps = {
  title: string;
  summary?: string | null;
  meta: ReactNode;
  body: string;
  toc?: RenderTocItem[];
  discussion?: ReactNode;
};

// Reading surface for an article: the title block rides inside the shell's
// article column so preview contexts (admin render tab) align with the body.
export function ArticleSurface({ title, summary, meta, body, toc = [], discussion }: ArticleSurfaceProps) {
  return <ReadingShell toc={toc} discussion={discussion}>
    <section className="articleTitleBlock">
      <header className="articleHeader">
        <span className="eyebrow">Writing</span>
        <h1>{title || "A writing"}</h1>
        <p>{summary}</p>
        {meta}
      </header>
    </section>
    <div className="articleBodyBlock">
      <div className="markdown"><MarkdownContent content={body} headingIds={toc.map((item) => item.id)} hideFirstH1 /></div>
    </div>
  </ReadingShell>;
}
