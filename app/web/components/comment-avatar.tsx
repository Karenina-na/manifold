"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Shuffle } from "lucide-react";
import { hashSeed } from "../lib/identity";
import styles from "../app/site.module.css";

const DOT_COLORS = ["var(--color-accent)", "var(--color-ink)", "var(--color-muted)"];
const GRID = 5;
const HALF = 3;
const FILL_RATE = 0.46;

function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function avatarDots(seed: string) {
  const random = mulberry32(hashSeed(seed));
  const color = DOT_COLORS[Math.floor(random() * DOT_COLORS.length)];
  const dots: Array<{ cx: number; cy: number; opacity: number }> = [];
  for (let column = 0; column < HALF; column += 1) {
    for (let row = 0; row < GRID; row += 1) {
      const value = random();
      if (value > FILL_RATE) continue;
      const cx = column + 0.5;
      const cy = row + 0.5;
      const opacity = 0.55 + random() * 0.45;
      dots.push({ cx, cy, opacity });
      if (column < HALF - 1) dots.push({ cx: GRID - 1 - column + 0.5, cy, opacity });
    }
  }
  return { color, dots };
}

export function CommentAvatar({ seed, size = 36 }: { seed: string; size?: number }) {
  const { color, dots } = avatarDots(seed);
  return <svg className={styles.commentAvatar} width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`} role="img" aria-hidden="true" focusable="false">
    <circle cx={GRID / 2} cy={GRID / 2} r={GRID / 2} fill="var(--color-accent-soft)" />
    {dots.map((dot, index) => <circle key={index} cx={dot.cx} cy={dot.cy} r={0.3} fill={color} opacity={dot.opacity} />)}
  </svg>;
}

const CANDIDATE_COUNT = 6;

export function AvatarPicker({ seed, onChange }: { seed: string; onChange: (seed: string) => void }) {
  const [open, setOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const candidates = Array.from({ length: CANDIDATE_COUNT }, (_, index) => `${seed}#${generation}#${index}`);

  return <div className={styles.avatarPicker} ref={containerRef}>
    <button type="button" className={styles.avatarPickerTrigger} aria-haspopup="dialog" aria-expanded={open} aria-label="Choose your avatar" title="Choose your avatar" onClick={() => setOpen((value) => !value)}>
      <CommentAvatar seed={seed} size={34} />
    </button>
    <AnimatePresence initial={false}>
      {open && <motion.div className={styles.avatarPickerPanel} role="dialog" aria-label="Avatar choices" initial={{ opacity: 0, y: -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.96 }} transition={{ duration: 0.16 }}>
        <div className={styles.avatarPickerGrid}>
          {candidates.map((candidate) => <button key={candidate} type="button" className={styles.avatarPickerOption} aria-pressed={candidate === seed} aria-label={`Use avatar ${candidate.slice(-1)}`} onClick={() => { onChange(candidate); setOpen(false); }}>
            <CommentAvatar seed={candidate} size={30} />
          </button>)}
        </div>
        <button type="button" className={styles.avatarPickerShuffle} onClick={() => setGeneration((value) => value + 1)}><Shuffle size={13} /> Shuffle</button>
      </motion.div>}
    </AnimatePresence>
  </div>;
}
