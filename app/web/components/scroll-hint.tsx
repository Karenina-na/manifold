"use client";

import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { ChevronsDown } from "lucide-react";
import { isWithinRevealViewport, revealObserverOptions } from "./reveal";
import styles from "../app/site.module.css";

type ScrollHintProps = { targetRef: RefObject<HTMLElement | null>; manual: boolean };

export function ScrollHint({ targetRef, manual }: ScrollHintProps) {
  const [phase, setPhase] = useState<"waiting" | "shown" | "fading" | "gone">("waiting");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPhase((current) => (current === "waiting" ? "shown" : current));
    }, 400);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const dismiss = () => setPhase((current) => (current === "shown" ? "fading" : "gone"));
    if (!manual) {
      const observer = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        dismiss();
      }, revealObserverOptions);
      observer.observe(target);
      return () => observer.disconnect();
    }
    const handleScroll = () => {
      if (!isWithinRevealViewport(target)) return;
      window.removeEventListener("scroll", handleScroll);
      dismiss();
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [manual, targetRef]);

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
