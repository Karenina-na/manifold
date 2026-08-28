"use client";

import { useEffect, type RefObject } from "react";
import { computeCenteredAsideOffset } from "./centered-aside";

const NAV_CLEARANCE = 112;
const SCROLL_SETTLE_MS = 160;

export function useCenteredAside(slotRef: RefObject<HTMLElement | null>, asideRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const slot = slotRef.current;
    const aside = asideRef.current;
    if (!slot || !aside) return;

    let frame = 0;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let lastOffset: number | null = null;

    const apply = (animate: boolean) => {
      if (getComputedStyle(aside).position === "static") {
        aside.style.transform = "";
        return;
      }
      const scrollTop = window.scrollY;
      const slotRect = slot.getBoundingClientRect();
      const offset = computeCenteredAsideOffset({
        viewportHeight: window.innerHeight,
        scrollTop,
        slotTop: slotRect.top + scrollTop,
        slotHeight: slotRect.height,
        asideHeight: aside.offsetHeight,
        navClearance: NAV_CLEARANCE,
      });
      if (offset === lastOffset) return;
      lastOffset = offset;
      aside.style.transition = animate ? "" : "none";
      aside.style.transform = `translateY(${offset}px)`;
    };

    const flush = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        apply(true);
      });
    };

    const scheduleSettle = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(flush, SCROLL_SETTLE_MS);
    };

    const observer = new ResizeObserver(scheduleSettle);
    observer.observe(slot);
    observer.observe(aside);

    apply(false);
    window.addEventListener("scroll", scheduleSettle, { passive: true });
    window.addEventListener("resize", scheduleSettle);
    return () => {
      window.removeEventListener("scroll", scheduleSettle);
      window.removeEventListener("resize", scheduleSettle);
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      if (settleTimer) clearTimeout(settleTimer);
      aside.style.transition = "";
      aside.style.transform = "";
    };
  }, [asideRef, slotRef]);
}
