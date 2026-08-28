"use client";

import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { ChevronsDown } from "lucide-react";
import { revealObserverOptions } from "./reveal";
import styles from "../app/site.module.css";

type ScrollHintProps = { targetRef: RefObject<HTMLElement | null> };

export function ScrollHint({ targetRef }: ScrollHintProps) {
  const [phase, setPhase] = useState<"waiting" | "shown" | "fading" | "gone">("waiting");
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      setRevealed(true);
      setPhase((current) => (current === "shown" ? "fading" : current === "waiting" ? "gone" : current));
    }, revealObserverOptions);
    observer.observe(target);
    return () => observer.disconnect();
  }, [targetRef]);

  useEffect(() => {
    if (revealed) return;
    const timer = window.setTimeout(() => {
      setPhase((current) => (current === "waiting" ? (targetRef.current ? "shown" : "gone") : current));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [revealed, targetRef]);

  useEffect(() => {
    if (phase !== "fading") return;
    const timer = window.setTimeout(() => setPhase("gone"), 520);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase !== "shown" && phase !== "fading") return null;

  return <button type="button" className={styles.scrollHint} data-fading={phase === "fading"} aria-label="Scroll to list" onClick={() => window.scrollBy({ top: Math.round(window.innerHeight * 0.9), behavior: "smooth" })}>
    <span aria-hidden="true"><ChevronsDown size={20} /></span>
  </button>;
}
