"use client";

import { useEffect, type RefObject } from "react";
import { FOCUSABLE_SELECTOR, focusWrapTarget } from "./modal-focus";

// Keeps keyboard focus inside a modal surface and hands it back to whatever was
// focused before it opened. Both call sites declare `role="dialog"
// aria-modal="true"`, which promises exactly that: without the trap, Tab walks
// out into the page behind the scrim, and without the restore the keyboard user
// is dropped at the top of the document on close.
//
// Call this *before* any effect that moves focus into the dialog: the opener has
// to be captured while it is still the active element.
export function useModalFocus(active: boolean, containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const target = focusWrapTarget(focusable, current, event.shiftKey);
      if (!target) return;
      event.preventDefault();
      target.focus();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // The opener is usually still mounted; if it is gone, leaving focus where
      // the browser put it is better than focusing a detached node.
      if (opener?.isConnected) opener.focus();
    };
  }, [active, containerRef]);
}
