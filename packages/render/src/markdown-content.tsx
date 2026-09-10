"use client";

// Single source for public content rendering, shared by app/web and app/admin.
// Changes to this file or render.css must be verified against BOTH surfaces —
// see packages/render/README.md before diverging.
import "./render.css";
import { remarkFootnotes } from "./footnotes";
import type { MdNode } from "./mdast";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, BadgeInfo, Check, Copy, ImageOff, Info, Lightbulb, Link as LinkIcon, ShieldAlert } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

// Pin the image parts of the sanitize schema instead of trusting the default:
// uploads render through img, and an upstream schema change must not silently
// turn every embedded image back into a plain link. Raw HTML (kbd/mark/…) is
// parsed by rehype-raw and then sanitized here as the final gate.
// clobberPrefix is disabled so footnote ids we emit (fn-1/fnref-1) match their
// hrefs; without this rehype-sanitize rewrites ids to user-content-* and the
// ref→definition navigation breaks.
const renderSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark"],
  attributes: {
    ...defaultSchema.attributes,
    // callout cards carry a semantic className; footnote popovers need their
    // span/sup classes kept, <mark> must survive sanitization, and footnote
    // anchors need their id + data-* attributes so ref→definition navigation
    // and the back-reference still work after sanitization.
    sup: [["className"]],
    span: [["className"]],
    mark: [["className"]],
    blockquote: [...(defaultSchema.attributes?.blockquote ?? []), "className"],
    img: [...(defaultSchema.attributes?.img ?? []), "srcSet", "width", "height", "loading", "decoding"],
    a: [...(defaultSchema.attributes?.a ?? []), ["id"], ["data-footnote-ref"], ["data-footnote-backref"], ["aria-label"]],
    li: [...(defaultSchema.attributes?.li ?? []), ["id"]],
    section: [...(defaultSchema.attributes?.section ?? []), ["data-footnotes"]],
  },
};

const CALLOUT_META: Record<string, { label: string; icon: typeof Info }> = {
  note: { label: "Note", icon: Info },
  tip: { label: "Tip", icon: Lightbulb },
  important: { label: "Important", icon: BadgeInfo },
  warning: { label: "Warning", icon: AlertTriangle },
  caution: { label: "Caution", icon: ShieldAlert },
};

const headingId = (value: React.ReactNode) => String(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/(^-|-$)/g, "");

const extractText = (node: React.ReactNode): string => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && node !== null && "props" in node) {
    return extractText((node as { props: { children?: React.ReactNode } }).props.children);
  }
  return "";
};

function ImageWithFallback({ node: _node, ...props }: React.ComponentProps<"img"> & { node?: unknown }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (failed) {
    return (
      <span className="mdrImgFallback" role="img" aria-label={props.alt || "Image failed to load"}>
        <ImageOff size={20} aria-hidden="true" />
        {props.alt ? <span>{props.alt}</span> : null}
      </span>
    );
  }
  const className = `${props.className ?? ""} ${loaded ? "mdrImgLoaded" : "mdrImgLoading"}`.trim();
  return <img {...props} loading="lazy" decoding="async" className={className} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />;
}

function TableWrap({ children }: { children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ overflow: false, atEnd: false });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const overflow = el.scrollWidth > el.clientWidth + 4;
      const atEnd = overflow && el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
      setState((prev) => (prev.overflow === overflow && prev.atEnd === atEnd ? prev : { overflow, atEnd }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, []);
  const classes = `mdrTableWrap${state.overflow ? " is-overflow" : ""}${state.atEnd ? " is-at-end" : ""}`;
  return <div ref={wrapRef} className={classes}>{children}</div>;
}

// GFM-style alerts: > [!NOTE] … maps the blockquote to a semantic callout card
// and strips the tag from the first paragraph. Runs at the mdast layer so the
// text edit and className land before hast conversion (no React-node surgery).
function remarkCallouts() {
  return (tree: MdNode) => {
    const walk = (node: MdNode) => {
      if (node.type === "blockquote") {
        const first = node.children?.[0];
        if (first?.type === "paragraph") {
          const textNode = first.children?.find((child) => child.type === "text");
          const value = textNode?.value ?? "";
          const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/.exec(value);
          if (match && textNode) {
            textNode.value = value.slice(match[0].length);
            // "> [!NOTE]" on its own line leaves an empty first paragraph
            // behind after the tag is stripped; drop it so the callout body
            // starts immediately below the tag.
            if (textNode.value.trim() === "") {
              node.children = (node.children ?? []).filter((child) => child !== first);
            }
            node.data = {
              ...node.data,
              hProperties: {
                className: `mdrCallout mdrCallout-${match[1].toLowerCase()}`,
              },
            };
          }
        }
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    const text = preRef.current?.textContent ?? "";
    if (!text || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const language = (() => {
    const child = Array.isArray(children) ? children[0] : children;
    const childProps = (child as React.ReactElement | null)?.props as { className?: string } | undefined;
    const match = /language-([\w-]+)/.exec(String(childProps?.className ?? ""));
    return match ? match[1] : null;
  })();

  const codeText = extractText(children);
  const lineCount = codeText.split("\n").length;
  const [expanded, setExpanded] = useState(false);
  const collapsible = lineCount > 12;
  const lineNumbers = Array.from({ length: lineCount }, (_, index) => index + 1).join("\n");

  return (
    <div className="codeFrame">
      <div className="codeToolbar">
        <span>{language ? language : "Plain Text"}</span>
        <button type="button" className={`codeCopy${copied ? " is-copied" : ""}`} onClick={copyCode} aria-label={copied ? "Copied" : "Copy code"} title={copied ? "Copied" : "Copy code"}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <div className={`codeCollapseWrap${expanded ? " is-expanded" : ""}`}>
        <div className="codeInner">
          <div className="codeBody">
            <div className="codeLineNumbers" aria-hidden="true">{lineNumbers}</div>
            <pre ref={preRef}>{children}</pre>
          </div>
        </div>
      </div>
      {collapsible ? (
        <button type="button" className="codeExpandBtn" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起" : `展开全部 ${lineCount} 行`}
        </button>
      ) : null}
    </div>
  );
}

function createHeadingLineIds(content: string, headingIds: string[]) {
  const lineIds = new Map<number, string>();
  let headingIndex = 0;
  let inFence = false;
  content.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const match = /^ {0,3}(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!match) return;
    lineIds.set(index + 1, headingIds[headingIndex++] ?? headingId(match[2]));
  });
  return lineIds;
}

function createComponents(content: string, headingIds: string[] = [], hideFirstH1 = false): Components {
  const headingLineIds = createHeadingLineIds(content, headingIds);
  const nextHeadingId = (children: React.ReactNode, node?: { position?: { start?: { line?: number } } }) => {
    const line = node?.position?.start?.line;
    return (line ? headingLineIds.get(line) : undefined) ?? headingId(children);
  };
  const anchorHeading = (level: "h2" | "h3" | "h4" | "h5" | "h6", props: { children?: React.ReactNode; node?: { position?: { start?: { line?: number } } } }) => {
    const id = nextHeadingId(props.children, props.node);
    const [copied, setCopied] = useState(false);
    const copyAnchor = (event: React.MouseEvent) => {
      event.preventDefault();
      const url = `${window.location.origin}${window.location.pathname}#${id}`;
      void navigator.clipboard?.writeText(url).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      });
    };
    const anchor = (
      <a className="mdr-anchor" href={`#${id}`} onClick={copyAnchor} title={copied ? "Copied" : "Copy link"} aria-label={copied ? "Copied link" : "Copy link to this section"}>
        <LinkIcon size={13} aria-hidden="true" />
      </a>
    );
    if (level === "h2") return <h2 id={id} data-content-heading>{anchor}{props.children}</h2>;
    if (level === "h3") return <h3 id={id} data-content-heading>{anchor}{props.children}</h3>;
    if (level === "h4") return <h4 id={id} data-content-heading>{anchor}{props.children}</h4>;
    if (level === "h5") return <h5 id={id} data-content-heading>{anchor}{props.children}</h5>;
    return <h6 id={id} data-content-heading>{anchor}{props.children}</h6>;
  };
  return {
    h1: ({ children }) => hideFirstH1 ? null : <h1>{children}</h1>,
    h2: (props) => anchorHeading("h2", props),
    h3: (props) => anchorHeading("h3", props),
    h4: (props) => anchorHeading("h4", props),
    h5: (props) => anchorHeading("h5", props),
    h6: (props) => anchorHeading("h6", props),
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    blockquote: ({ className, children }) => {
      const type = String(className ?? "").match(/mdrCallout-(\w+)/)?.[1];
      const meta = type ? CALLOUT_META[type] : undefined;
      if (!meta) return <blockquote className={className}>{children}</blockquote>;
      const Icon = meta.icon;
      return (
        <blockquote className={className}>
          <span className="mdrCalloutTag"><Icon size={13} aria-hidden="true" />{meta.label}</span>
          {children}
        </blockquote>
      );
    },
    table: ({ children }) => <TableWrap><table>{children}</table></TableWrap>,
    img: (props) => {
      const { title, ...rest } = props;
      const image = <ImageWithFallback {...rest} />;
      if (!title) return image;
      return (
        <figure className="mdrFigure">
          {image}
          <figcaption>{title}</figcaption>
        </figure>
      );
    },
  };
}

export function MarkdownContent({ content, headingIds, hideFirstH1 = false }: { content: string; headingIds?: string[]; hideFirstH1?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkCallouts, remarkGfm, remarkFootnotes, remarkMath]}
      remarkRehypeOptions={{ allowDangerousHtml: true, clobberPrefix: "" }}
      rehypePlugins={[[rehypeRaw], [rehypeSanitize, { ...renderSchema, clobberPrefix: "" }], rehypeKatex, rehypeHighlight]}
      components={createComponents(content, headingIds, hideFirstH1)}
    >
      {content}
    </ReactMarkdown>
  );
}
