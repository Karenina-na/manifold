"use client";

import { Terminal, X, CornerDownLeft, ExternalLink, Circle } from "lucide-react";
import type { TFunction } from "i18next";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { evaluateArithmetic } from "../../lib/expression";
import { buildHref, createBrowserClient } from "../../lib/api";
import { DEFAULT_LOCALE, parseLocale } from "../../i18n/locale";
import { applyTheme, normalizeTheme } from "../../lib/theme";
import styles from "../../app/site.module.css";

export type Paper = { title: string; href: string };

type OutputLine = {
  text: string;
  type?: "default" | "error" | "success" | "system" | "link";
  href?: string;
};

type ReplOutput = {
  id: number;
  command: string;
  timestamp: string;
  lines: OutputLine[];
};

type FloatingReplProps = {
  displayName: string;
  handle?: string;
  focus: string;
};

const COMMANDS = [
  "help",
  "ls",
  "pwd",
  "cd",
  "cat",
  "whoami",
  "now",
  "papers",
  "open",
  "theme",
  "calc",
  "ping",
  "ascii",
  "clear",
  "exit",
  "quit",
  "close",
  "sudo",
];

export function FloatingRepl({ displayName, handle, focus }: FloatingReplProps) {
  const { t, i18n } = useTranslation();
  const locale = parseLocale(i18n.resolvedLanguage ?? i18n.language) ?? DEFAULT_LOCALE;
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [outputs, setOutputs] = useState<ReplOutput[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [isBusy, setIsBusy] = useState(false);
  const [cwd, setCwd] = useState("~");
  const [papers, setPapers] = useState<Paper[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const outputId = useRef(0);
  const papersRequested = useRef(false);

  // The `papers` and `open` commands are the only consumers of the archive, and
  // the REPL is closed on nearly every page view. Fetching it lazily on first
  // open keeps a 50-article request off every route's critical path.
  useEffect(() => {
    if (!open || papersRequested.current) return;
    papersRequested.current = true;
    void createBrowserClient().content({ kind: "ARTICLE", pageSize: 50 })
      .then((page) => setPapers(page.data.map((item) => ({ title: item.title ?? "", href: buildHref(item) }))))
      .catch(() => { papersRequested.current = false; });
  }, [open]);

  // 快捷键唤醒与退出
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 打开时自动聚焦
  useEffect(() => {
    if (!open || isBusy) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, isBusy]);

  // 输出更新时自动滚动到底部
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [outputs]);

  // 键盘操作：历史记录导航与 Tab 补全
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
      event.preventDefault();
      setOutputs([]);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (history.length === 0) return;
      const nextIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setInput(history[nextIndex]);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (historyIndex === -1) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) {
        setHistoryIndex(-1);
        setInput("");
      } else {
        setHistoryIndex(nextIndex);
        setInput(history[nextIndex]);
      }
    } else if (event.key === "Tab") {
      event.preventDefault();
      const current = input.trim().toLowerCase();
      if (!current) return;
      const match = COMMANDS.find((cmd) => cmd.startsWith(current));
      if (match) {
        setInput(match);
      }
    } else if ((event.ctrlKey && event.key === "c") || (event.metaKey && event.key === "c")) {
      // 中断当前输入
      setInput("");
      setHistoryIndex(-1);
    }
  };

  async function runCommand(rawCommand: string) {
    const trimmed = rawCommand.trim();
    if (!trimmed || isBusy) return;

    // 记录历史
    setHistory((prev) => [...prev, trimmed]);
    setHistoryIndex(-1);
    setInput("");

    // 特殊指令：clear
    if (trimmed.toLowerCase() === "clear") {
      setOutputs([]);
      return;
    }
    if (["exit", "quit", "close"].includes(trimmed.toLowerCase())) {
      setOpen(false);
      return;
    }

    const timestamp = new Date().toLocaleTimeString(locale, { hour12: false });
    const currentId = outputId.current++;

    // 占位输出
    setOutputs((current) => [
      ...current,
      { id: currentId, command: trimmed, timestamp, lines: [] },
    ]);

    setIsBusy(true);
    const resolvedLines = await executeCommand(trimmed, { displayName, handle, focus, papers, t });
    setIsBusy(false);
    if (trimmed.toLowerCase() === "cd" || trimmed.toLowerCase() === "cd ~") setCwd("~");
    const [enteredCommand, enteredTarget] = trimmed.toLowerCase().split(/\s+/);
    if (enteredCommand === "cd") {
      const target = (enteredTarget ?? "~").replace(/\/$/, "");
      if (target === "~") setCwd("~");
      if (target === "papers") setCwd("/papers");
      if (target === "contact") setCwd("/contact");
    }

    setOutputs((current) =>
      current.map((item) => (item.id === currentId ? { ...item, lines: resolvedLines } : item))
    );
  }

  return (
    <aside className={styles.floatingRepl} data-floating-repl>
      {!open && (
        <button
          className={styles.replCapsule}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("repl.open")}
          title={t("repl.openTitle")}
        >
          <Terminal size={14} aria-hidden="true" />
          <span>REPL</span>
          <kbd>⌘J</kbd>
        </button>
      )}

      <div className={styles.replScrim} data-open={open} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <section
          className={styles.replDialog}
          data-open={open}
          role="dialog"
          aria-modal="false"
          aria-labelledby="repl-title"
        >
          <header className={styles.replHeader}>
            <span id="repl-title">
              <span className={styles.replWindowTitle}><Terminal size={13} aria-hidden="true" /> manifold://{cwd === "~" ? "home" : cwd.replace(/^\//, "")}</span>
              <span className={styles.replWindowStatus}><Circle size={7} fill="currentColor" /> {t("repl.online")}</span>
            </span>
            <button
              className={styles.replClose}
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("repl.close")}
            >
              <X size={15} />
            </button>
          </header>

          <div className={styles.replBody} ref={bodyRef} aria-live="polite">
            <div className={styles.replWelcome}>
              <span>manifold://home</span>
              <small>{t("repl.welcome")}</small>
            </div>

            {outputs.map((output) => (
              <div className={styles.replOutput} data-repl-output key={output.id}>
                <div className={styles.replPromptLine}>
                  <span className={styles.replPrompt}>&gt; {output.command}</span>
                  <time className={styles.replTimestamp}>{output.timestamp}</time>
                </div>
                {output.lines.map((line, idx) => (
                  <div
                    key={idx}
                    className={`${styles.replLine} ${line.type ? styles[line.type] : ""}`}
                  >
                    {line.type === "link" && line.href ? (
                      <a href={line.href} target="_blank" rel="noopener noreferrer">
                        {line.text} <ExternalLink size={11} />
                      </a>
                    ) : (
                      <span>{line.text}</span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>

          <form
            className={styles.replForm}
            onSubmit={(event) => {
              event.preventDefault();
              runCommand(input);
            }}
          >
            <span className={styles.replPrompt} aria-hidden="true">
              {cwd} &gt;
            </span>
            <input
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isBusy}
              aria-label={t("repl.label")}
              autoComplete="off"
              spellCheck={false}
              placeholder={isBusy ? t("repl.executing") : t("repl.placeholder")}
            />
            <button type="submit" className={styles.replSubmit} aria-label={t("repl.run")}>
              <CornerDownLeft size={12} />
            </button>
          </form>
        </section>
      </div>
    </aside>
  );
}

// 命令执行引擎
async function executeCommand(
  rawInput: string,
  ctx: { displayName: string; handle?: string; focus: string; papers: Paper[]; t: TFunction }
): Promise<OutputLine[]> {
  const [cmd, ...args] = rawInput.split(" ");
  const command = cmd.toLowerCase();

  switch (command) {
    case "pwd":
      return [{ text: "/home/manifold", type: "system" }];

    case "ls":
      return [
        { text: "about.md        focus.txt        papers/", type: "system" },
        { text: "contact/        README.md", type: "system" },
      ];

    case "cd": {
      const target = args[0] ?? "~";
      const normalizedTarget = target.replace(/\/$/, "");
      if (["~", "papers", "contact"].includes(normalizedTarget)) return [{ text: ctx.t("repl.switched", { path: normalizedTarget === "~" ? "/home/manifold" : `/${normalizedTarget}` }), type: "success" }];
      return [{ text: ctx.t("repl.noDirectory", { target }), type: "error" }];
    }

    case "cat": {
      const file = args[0]?.toLowerCase();
      if (file === "readme.md" || file === "about.md") return [{ text: ctx.t("repl.about", { name: ctx.displayName }), type: "system" }];
      if (file === "focus.txt") return [{ text: ctx.focus, type: "success" }];
      return [{ text: ctx.t("repl.noFile", { file: args[0] ?? "" }), type: "error" }];
    }

    case "whoami":
      return [
        { text: `${ctx.displayName} ${ctx.handle ? `(@${ctx.handle})` : ""}`, type: "system" },
        { text: ctx.t("repl.identityVerified") },
      ];

    case "now":
      return [
        { text: ctx.t("repl.activeFocus"), type: "system" },
        { text: ctx.focus, type: "success" },
      ];

    case "papers":
      if (!ctx.papers.length) {
        return [{ text: ctx.t("repl.noPapers"), type: "error" }];
      }
      return [
        { text: ctx.t("repl.foundPublications", { count: ctx.papers.length }), type: "system" },
        ...ctx.papers.flatMap((p, i) => [
          { text: `[${i + 1}] ${p.title || ctx.t("repl.untitled")}`, type: "link" as const, href: p.href },
        ]),
        { text: ctx.t("repl.openTip") },
      ];

    case "open": {
      const targetIndex = parseInt(args[0], 10) - 1;
      if (isNaN(targetIndex) || !ctx.papers[targetIndex]) {
        return [{ text: ctx.t("repl.invalidIndex"), type: "error" }];
      }
      const paper = ctx.papers[targetIndex];
      window.open(paper.href, "_blank", "noopener,noreferrer");
      return [{ text: ctx.t("repl.opened", { title: paper.title || ctx.t("repl.untitled") }), type: "success" }];
    }

    case "theme": {
      const mode = args[0]?.toLowerCase();
      const current = normalizeTheme(document.documentElement.dataset.theme);
      // Route through the shared helper so the nav toggle's React state and the
      // Radix appearance stay in sync with the attribute.
      const nextTheme = mode === "dark" || mode === "light" ? mode : current === "dark" ? "light" : "dark";
      applyTheme(nextTheme);
      return [
        { text: ctx.t("repl.themeSwitched", { theme: ctx.t(nextTheme === "dark" ? "repl.dark" : "repl.light") }), type: "success" },
      ];
    }

    case "calc": {
      const expr = args.join("");
      if (!expr) return [{ text: ctx.t("repl.calcUsage"), type: "error" }];
      // The regex is a friendly pre-check, not the security boundary: the
      // expression is parsed by lib/expression.ts instead of being handed to
      // eval, so a CSP without 'unsafe-eval' does not break the command.
      if (!/^[0-9+\-*/().\s^%]+$/.test(expr)) {
        return [{ text: ctx.t("repl.calcSyntaxError"), type: "error" }];
      }
      try {
        return [{ text: `= ${evaluateArithmetic(expr)}`, type: "success" }];
      } catch {
        return [{ text: ctx.t("repl.calcError"), type: "error" }];
      }
    }

    case "ping": {
      const target = args[0] || "core.manifold.internal";
      // 模拟延迟
      await new Promise((res) => setTimeout(res, 600));
      return [
        { text: ctx.t("repl.pingHeader", { target }) },
        { text: ctx.t("repl.pingReply"), type: "success" },
      ];
    }

    case "ascii":
    case "manifold":
      return [
        { text: "      .---.       " },
        { text: "     /  M  \\      ", type: "system" },
        { text: "    |   •   |     " },
        { text: "     \\     /      " },
        { text: "      '---'       " },
        { text: ctx.t("repl.runtimeInitialized"), type: "success" },
      ];

    case "sudo":
      return [
        { text: ctx.t("repl.sudoDenied"), type: "error" },
      ];

    case "help":
      return [
        { text: ctx.t("repl.helpTitle"), type: "system" },
        { text: `• ls           : ${ctx.t("repl.helpLs")}` },
        { text: `• pwd          : ${ctx.t("repl.helpPwd")}` },
        { text: `• cd <dir>     : ${ctx.t("repl.helpCd")}` },
        { text: `• cat <file>   : ${ctx.t("repl.helpCat")}` },
        { text: `• whoami:       ${ctx.t("repl.helpWhoami")}` },
        { text: `• now:          ${ctx.t("repl.helpNow")}` },
        { text: `• papers:       ${ctx.t("repl.helpPapers")}` },
        { text: `• open <idx>:   ${ctx.t("repl.helpOpen")}` },
        { text: `• theme <mode>: ${ctx.t("repl.helpTheme")}` },
        { text: `• calc <expr>:  ${ctx.t("repl.helpCalc")}` },
        { text: `• ping [host]:  ${ctx.t("repl.helpPing")}` },
        { text: `• clear:        ${ctx.t("repl.helpClear")}` },
        { text: `• exit/quit:    ${ctx.t("repl.helpExit")}` },
        { text: `• ascii:        ${ctx.t("repl.helpAscii")}` },
      ];

    default:
      return [
        { text: ctx.t("repl.commandNotFound", { command }), type: "error" },
        { text: ctx.t("repl.helpHint") },
      ];
  }
}
