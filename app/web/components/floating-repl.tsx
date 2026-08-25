"use client";

import { Terminal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "../app/site.module.css";

type Paper = { title: string; href: string };
type ReplOutput = { id: number; command: string; lines: string[] };

type FloatingReplProps = {
  displayName: string;
  handle?: string;
  focus: string;
  papers: Paper[];
};

export function FloatingRepl({ displayName, handle, focus, papers }: FloatingReplProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [outputs, setOutputs] = useState<ReplOutput[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputId = useRef(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function runCommand(rawCommand: string) {
    const command = rawCommand.trim().toLowerCase();
    if (!command) return;
    const lines = resolveCommand(command, { displayName, handle, focus, papers });
    setOutputs((current) => [...current, { id: outputId.current++, command, lines }].slice(-6));
    setInput("");
  }

  return <aside className={styles.floatingRepl} data-floating-repl>
    {!open && <button className={styles.replCapsule} type="button" onClick={() => setOpen(true)} aria-label="Open command line" title="Open command line (⌘J)"><Terminal size={14} aria-hidden="true" /><span>REPL</span><kbd>⌘J</kbd></button>}
    {open && <section className={styles.replDialog} role="dialog" aria-modal="false" aria-labelledby="repl-title">
      <header className={styles.replHeader}><span id="repl-title"><Terminal size={13} aria-hidden="true" /> Floating REPL</span><button className={styles.replClose} type="button" onClick={() => setOpen(false)} aria-label="Close command line"><X size={15} /></button></header>
      <div className={styles.replBody} aria-live="polite">
        <div className={styles.replWelcome}><span>manifold://home</span><small>whoami · now · papers · theme · ascii</small></div>
        {outputs.map((output) => <div className={styles.replOutput} data-repl-output key={output.id}><span className={styles.replPrompt}>&gt; {output.command}</span>{output.lines.map((line) => <span key={line}>{line}</span>)}</div>)}
      </div>
      <form className={styles.replForm} onSubmit={(event) => { event.preventDefault(); runCommand(input); }}>
        <span className={styles.replPrompt} aria-hidden="true">&gt;</span><input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} aria-label="Command line" autoComplete="off" spellCheck={false} placeholder="enter a command" />
      </form>
    </section>}
  </aside>;
}

function resolveCommand(command: string, context: { displayName: string; handle?: string; focus: string; papers: Paper[] }) {
  if (command === "whoami") return [`${context.displayName}${context.handle ? ` · ${context.handle}` : ""}`, "public profile / manifold"];
  if (command === "now") return [context.focus, "current focus / live from Core"];
  if (command === "papers") return context.papers.length ? context.papers.map((paper) => `${paper.title} · ${paper.href}`) : ["No papers in the public archive."];
  if (command === "theme") return [`theme / ${document.documentElement.dataset.theme ?? "light"}`, "use the moon control to switch modes"];
  if (command === "ascii" || command === "manifold") return ["   .---.", "  /  M  \\", "  '---'", "  manifold in motion"];
  if (command === "help") return ["whoami · now · papers · theme · ascii"];
  return [`command not found: ${command}`, "try: whoami · now · papers · theme · ascii"];
}
