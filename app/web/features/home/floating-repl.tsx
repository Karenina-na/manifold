"use client";

import { CornerDownLeft, Terminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useModalFocus } from "../../components/ui/use-modal-focus";
import { buildHref, createBrowserClient } from "../../lib/api";
import { applyTheme, normalizeTheme } from "../../lib/theme";
import {
  createTerminalFilesystem,
  completeTerminalInput,
  executeTerminalCommand,
  loadAllTerminalContent,
  TERMINAL_COMMANDS,
  terminalUsername,
  type TerminalContent,
  type TerminalLine,
} from "./terminal-filesystem";
import styles from "../../app/site.module.css";

type TerminalOutput = { id: number; command: string; cwd: string; lines: TerminalLine[] };

type FloatingReplProps = {
  displayName: string;
  handle?: string;
  description: string;
  focus: string;
  links: Array<{ label: string; href: string }>;
};

const hostname = "manifold-mac";

export function FloatingRepl({ displayName, handle, description, focus, links }: FloatingReplProps) {
  const { t } = useTranslation();
  const username = terminalUsername(handle);
  const home = `/Users/${username}`;
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [outputs, setOutputs] = useState<TerminalOutput[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [cwd, setCwd] = useState(home);
  const [contents, setContents] = useState<TerminalContent[]>([]);
  const [contentStatus, setContentStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const outputId = useRef(0);
  const contentsRequested = useRef(false);
  useModalFocus(open, dialogRef, openerRef);

  const filesystem = useMemo(() => createTerminalFilesystem({
    displayName, handle, description, focus, contents, links,
  }), [contents, description, displayName, focus, handle, links]);

  useEffect(() => {
    if (!open || contentsRequested.current) return;
    contentsRequested.current = true;
    setContentStatus("loading");
    const client = createBrowserClient();
    void loadAllTerminalContent(async (kind, page) => {
      const result = await client.content({ kind, page, pageSize: 100 });
      return {
        data: result.data.map((item) => ({
          kind: item.kind,
          slug: item.slug,
          title: item.title,
          summary: item.summary,
          tags: item.tags,
          publishedAt: item.publishedAt,
          href: buildHref(item),
        })),
        totalPages: result.pagination.totalPages,
      };
    }).then((mountedContents) => {
      setContents(mountedContents);
      setContentStatus("ready");
    }).catch(() => {
      contentsRequested.current = false;
      setContentStatus("error");
    });
  }, [open]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setOpen((current) => {
          if (!current) openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : triggerRef.current;
          return !current;
        });
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [outputs, contentStatus]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
      event.preventDefault();
      setOutputs([]);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!history.length) return;
      const nextIndex = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setInput(history[nextIndex]);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (historyIndex < 0) return;
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex >= history.length ? -1 : nextIndex);
      setInput(nextIndex >= history.length ? "" : history[nextIndex]);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const completion = completeTerminalInput(input, { filesystem, cwd, home });
      if (completion) setInput(completion);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      setInput("");
      setHistoryIndex(-1);
    }
  }

  function runCommand(rawCommand: string) {
    const command = rawCommand.trim();
    if (!command) return;
    const result = executeTerminalCommand(command, {
      filesystem,
      cwd,
      home,
      username,
      hostname,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    setHistory((current) => [...current, command]);
    setHistoryIndex(-1);
    setInput("");
    setCwd(result.cwd);

    if (result.action?.type === "clear") {
      setOutputs([]);
      return;
    }
    if (result.action?.type === "close") {
      setOpen(false);
      return;
    }

    let lines = result.lines;
    if (result.action?.type === "theme") {
      const current = normalizeTheme(document.documentElement.dataset.theme);
      const next = result.action.mode ?? (current === "dark" ? "light" : "dark");
      applyTheme(next);
      lines = [{ text: t("repl.themeSwitched", { theme: t(next === "dark" ? "repl.dark" : "repl.light") }), type: "success" }];
    }
    if (result.action?.type === "open") window.open(result.action.href, "_blank", "noopener,noreferrer");

    setOutputs((current) => [...current, { id: outputId.current++, command, cwd, lines }]);
  }

  const promptDirectory = cwd === home ? "~" : cwd === "/" ? "/" : cwd.split("/").at(-1);
  const writingCount = contents.filter((item) => item.kind === "ARTICLE").length;
  const thoughtCount = contents.filter((item) => item.kind === "THOUGHT").length;

  return (
    <aside className={styles.floatingRepl} data-floating-repl>
      <button ref={triggerRef} className={styles.replCapsule} data-open={open} type="button" onClick={() => { openerRef.current = triggerRef.current; setOpen(true); }} aria-hidden={open} tabIndex={open ? -1 : 0} aria-label={t("repl.open")} title={t("repl.openTitle")}>
        <Terminal size={14} aria-hidden="true" />
        <span>Terminal</span>
        <kbd>⌘J</kbd>
      </button>

      <div className={styles.replScrim} data-open={open} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <section ref={dialogRef} className={styles.replDialog} data-open={open} role="dialog" aria-modal="true" aria-labelledby="repl-title">
          <header className={styles.replHeader}>
            <div className={styles.replTrafficLights} role="group" aria-label={t("repl.windowControls")}>
              <button type="button" className={styles.replTrafficClose} onClick={() => setOpen(false)} aria-label={t("repl.close")} />
              <span className={styles.replTrafficMinimize} aria-hidden="true" />
              <span className={styles.replTrafficZoom} aria-hidden="true" />
            </div>
            <span className={styles.replWindowTitle} id="repl-title">{username} — -zsh — 80×24</span>
            <span className={styles.replHeaderSpacer} aria-hidden="true" />
          </header>

          <div className={styles.replBody} ref={bodyRef} aria-live="polite">
            <div className={styles.replWelcome}>
              <span>Last login: today on ttys001</span>
              <small data-repl-index-status>
                {contentStatus === "loading" && t("repl.indexing")}
                {contentStatus === "ready" && t("repl.indexed", { writings: writingCount, thoughts: thoughtCount })}
                {contentStatus === "error" && t("repl.indexError")}
              </small>
            </div>

            {outputs.map((output) => (
              <div className={styles.replOutput} data-repl-output key={output.id}>
                <div className={styles.replPromptLine}>
                  <span className={styles.replPromptUser}>{username}@{hostname}</span>
                  <span className={styles.replPromptPath}>{output.cwd === home ? "~" : output.cwd}</span>
                  <span className={styles.replPromptMark}>%</span>
                  <span className={styles.replCommand}>{output.command}</span>
                </div>
                {output.lines.map((line, index) => (
                  <div key={index} className={`${styles.replLine} ${line.type ? styles[line.type] : ""}`}>
                    {line.type === "link" && line.href ? <a href={line.href} target="_blank" rel="noopener noreferrer">{line.text}</a> : <span>{line.text || "\u00a0"}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>

          <form className={styles.replForm} onSubmit={(event) => { event.preventDefault(); runCommand(input); }}>
            <span className={styles.replPromptUser}>{username}@{hostname}</span>
            <span className={styles.replPromptPath}>{promptDirectory}</span>
            <span className={styles.replPromptMark}>%</span>
            <input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleKeyDown} aria-label={t("repl.label")} autoComplete="off" spellCheck={false} placeholder={t("repl.placeholder")} />
            <button type="submit" className={styles.replSubmit} aria-label={t("repl.run")}><CornerDownLeft size={12} /></button>
          </form>
        </section>
      </div>
    </aside>
  );
}
