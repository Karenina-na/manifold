"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TagSummary } from "@manifold/contracts";
import { orderSelectedFirst } from "../lib/tag-order";
import styles from "../app/site.module.css";

type TagPickerProps = {
  tags: TagSummary[];
  activeTags: string[];
  onToggle: (name: string) => void;
  label: string;
};

export function TagPicker({ tags, activeTags, onToggle, label }: TagPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return <div className={styles.tagPicker}>
    <button type="button" ref={triggerRef} className={styles.tagPickerTrigger} aria-expanded={open} onClick={() => setOpen((value) => !value)}>{label}</button>
    {open && createPortal(
      <div className={styles.tagPickerPanel} ref={panelRef} role="group" aria-label={label}>
        {orderSelectedFirst(tags, activeTags).map((item) => <button key={item.name} type="button" className={activeTags.includes(item.name) ? styles.tagPillActive : styles.tagPill} onClick={() => onToggle(item.name)}>{item.name} <small>{item.count}</small></button>)}
      </div>,
      document.body
    )}
  </div>;
}
