"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import styles from "../app/site.module.css";

const headingId = (value: React.ReactNode) => String(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/(^-|-$)/g, "");

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

  return (
    <div className={styles.codeFrame}>
      <div className={styles.codeToolbar}>
        <span>Code</span>
        <button type="button" className={styles.codeCopy} onClick={copyCode} aria-label={copied ? "Copied" : "Copy code"} title={copied ? "Copied" : "Copy code"}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre ref={preRef}>{children}</pre>
    </div>
  );
}

function createComponents(headingIds: string[] = [], hideFirstH1 = false): Components {
  let headingIndex = 0;
  const nextHeadingId = (children: React.ReactNode) => headingIds[headingIndex++] ?? headingId(children);
  return {
    h1: ({ children }) => hideFirstH1 ? null : <h1>{children}</h1>,
    h2: ({ children }) => <h2 id={nextHeadingId(children)} data-content-heading>{children}</h2>,
    h3: ({ children }) => <h3 id={nextHeadingId(children)} data-content-heading>{children}</h3>,
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  };
}

export function MarkdownContent({ content, headingIds, hideFirstH1 = false }: { content: string; headingIds?: string[]; hideFirstH1?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeSanitize, rehypeKatex, rehypeHighlight]}
      components={createComponents(headingIds, hideFirstH1)}
    >
      {content}
    </ReactMarkdown>
  );
}
