"use client";

// Lightweight Markdown for comment bodies: GFM plus soft line breaks, fully
// sanitized, with headings, images and math removed. Comments are short texts
// typed in a plain textarea, so a single Enter renders as a line break and
// there is no code-block toolbar or TOC machinery (see MarkdownContent for the
// article surface, which intentionally keeps those).
import "./render.css";
import ReactMarkdown from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

// Drop headings and images from the default schema: a comment must not be able
// to inject a heading outline or an external image (tracking pixels, content
// surprises) into the discussion thread.
const commentSchema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((tag) => !["img", "h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)),
};

export function CommentMarkdown({ content }: { content: string }) {
  return (
    <div className="commentMarkdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[[rehypeSanitize, commentSchema]]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
