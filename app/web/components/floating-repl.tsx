"use client";

import { Terminal, X, CornerDownLeft, ExternalLink, Circle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "../app/site.module.css";

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
  papers: Paper[];
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
  "sudo",
];

export function FloatingRepl({ displayName, handle, focus, papers }: FloatingReplProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [outputs, setOutputs] = useState<ReplOutput[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [isBusy, setIsBusy] = useState(false);
  const [cwd, setCwd] = useState("~");

  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const outputId = useRef(0);

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

    const timestamp = new Date().toLocaleTimeString([], { hour12: false });
    const currentId = outputId.current++;

    // 占位输出
    setOutputs((current) => [
      ...current,
      { id: currentId, command: trimmed, timestamp, lines: [] },
    ]);

    setIsBusy(true);
    const resolvedLines = await executeCommand(trimmed, { displayName, handle, focus, papers });
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
          aria-label="Open command line"
          title="Open command line (⌘J)"
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
              <span className={styles.replWindowStatus}><Circle size={7} fill="currentColor" /> online</span>
            </span>
            <button
              className={styles.replClose}
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close command line"
            >
              <X size={15} />
            </button>
          </header>

          <div className={styles.replBody} ref={bodyRef} aria-live="polite">
            <div className={styles.replWelcome}>
              <span>manifold://home</span>
              <small>Simulated shell · `help` for commands · Tab to autocomplete · ↑↓ for history</small>
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
              aria-label="Command line"
              autoComplete="off"
              spellCheck={false}
              placeholder={isBusy ? "executing..." : "try `ls`, `cat about.md`, or `papers`"}
            />
            <button type="submit" className={styles.replSubmit} aria-label="Run command">
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
  ctx: { displayName: string; handle?: string; focus: string; papers: Paper[] }
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
      if (["~", "papers", "contact"].includes(normalizedTarget)) return [{ text: `switched to ${normalizedTarget === "~" ? "/home/manifold" : `/${normalizedTarget}`}`, type: "success" }];
      return [{ text: `cd: no such directory: ${target}`, type: "error" }];
    }

    case "cat": {
      const file = args[0]?.toLowerCase();
      if (file === "readme.md" || file === "about.md") return [{ text: `${ctx.displayName} keeps a public garden of technical writing, short thoughts, and experiments.`, type: "system" }];
      if (file === "focus.txt") return [{ text: ctx.focus, type: "success" }];
      return [{ text: `cat: ${args[0] ?? ""}: No such file`, type: "error" }];
    }

    case "whoami":
      return [
        { text: `${ctx.displayName} ${ctx.handle ? `(@${ctx.handle})` : ""}`, type: "system" },
        { text: "Identity Verified: Core Contributor / Manifold Space" },
      ];

    case "now":
      return [
        { text: "Active Focus:", type: "system" },
        { text: ctx.focus, type: "success" },
      ];

    case "papers":
      if (!ctx.papers.length) {
        return [{ text: "No papers in the public archive.", type: "error" }];
      }
      return [
        { text: `Found ${ctx.papers.length} publications:`, type: "system" },
        ...ctx.papers.flatMap((p, i) => [
          { text: `[${i + 1}] ${p.title}`, type: "link" as const, href: p.href },
        ]),
        { text: "Tip: Type `open <index>` to launch directly (e.g. `open 1`)" },
      ];

    case "open": {
      const targetIndex = parseInt(args[0], 10) - 1;
      if (isNaN(targetIndex) || !ctx.papers[targetIndex]) {
        return [{ text: "Invalid index. Usage: open <paper_number>", type: "error" }];
      }
      const paper = ctx.papers[targetIndex];
      window.open(paper.href, "_blank", "noopener,noreferrer");
      return [{ text: `Opened: "${paper.title}" in new tab.`, type: "success" }];
    }

    case "theme": {
      const mode = args[0]?.toLowerCase();
      const current = document.documentElement.dataset.theme || "light";
      let nextTheme = current === "dark" ? "light" : "dark";

      if (mode === "dark" || mode === "light") {
        nextTheme = mode;
      }

      document.documentElement.dataset.theme = nextTheme;
      return [
        { text: `System theme switched to [${nextTheme.toUpperCase()}].`, type: "success" },
      ];
    }

    case "calc": {
      const expr = args.join("");
      if (!expr) return [{ text: "Usage: calc <expression> (e.g. calc 1024 / 4)", type: "error" }];
      // 安全简单的计算器正则校验
      if (!/^[0-9+\-*/().\s^%]+$/.test(expr)) {
        return [{ text: "Syntax Error: Only mathematical operators allowed.", type: "error" }];
      }
      try {
        const sanitized = expr.replace(/\^/g, "**");
        const result = Function(`"use strict"; return (${sanitized})`)();
        return [{ text: `= ${result}`, type: "success" }];
      } catch {
        return [{ text: "Math Evaluation Error.", type: "error" }];
      }
    }

    case "ping": {
      const target = args[0] || "core.manifold.internal";
      // 模拟延迟
      await new Promise((res) => setTimeout(res, 600));
      return [
        { text: `PING ${target} (127.0.0.1): 56 data bytes` },
        { text: `64 bytes from 127.0.0.1: icmp_seq=0 ttl=64 time=14.2 ms`, type: "success" },
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
        { text: " manifold runtime initialized.", type: "success" },
      ];

    case "sudo":
      return [
        { text: "User is not in the sudoers file. This incident will be reported.", type: "error" },
      ];

    case "help":
      return [
        { text: "Available System Directives:", type: "system" },
        { text: "• ls           : List the simulated home directory" },
        { text: "• pwd          : Print the simulated working directory" },
        { text: "• cd <dir>     : Move between papers/ and contact/" },
        { text: "• cat <file>   : Read about.md, focus.txt, or README.md" },
        { text: "• whoami       : Print active user session identity" },
        { text: "• now          : Fetch real-time research & production focus" },
        { text: "• papers       : List indexed research publications" },
        { text: "• open <idx>   : Launch specific publication in browser" },
        { text: "• theme <mode> : Toggle or set explicit theme (light|dark)" },
        { text: "• calc <expr>  : Safe math evaluation engine" },
        { text: "• ping [host]  : Measure latency to internal nodes" },
        { text: "• clear        : Flush and clear terminal buffer" },
        { text: "• ascii        : Render ASCII system glyph" },
      ];

    default:
      return [
        { text: `zsh: command not found: ${command}`, type: "error" },
        { text: "Type `help` to see available commands." },
      ];
  }
}
