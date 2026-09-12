"use client";

// Reading-surface image lightbox. Any <img> inside a .markdown block opens on
// click; delegated at the document level so the shared renderer package stays
// untouched. Overlay closes on Escape, background click or the close button,
// locks body scroll, moves focus to the button while open, keeps Tab inside the
// overlay and returns focus to the opener on close (via `useModalFocus`).
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useModalFocus } from "../lib/use-modal-focus";
import styles from "../app/site.module.css";

export function ArticleLightbox() {
  const [src, setSrc] = useState<string | null>(null);
  const [alt, setAlt] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Declared before the effect that focuses the close button so the opener is
  // captured while it is still the active element.
  useModalFocus(src !== null, dialogRef);

  useEffect(() => {
    const openFromClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const img = target?.closest?.(".markdown img");
      if (!(img instanceof HTMLImageElement) || !img.src) return;
      event.preventDefault();
      setSrc(img.currentSrc || img.src);
      setAlt(img.alt || "");
    };
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSrc(null);
    };
    document.addEventListener("click", openFromClick, true);
    document.addEventListener("keydown", closeOnKey, true);
    return () => {
      document.removeEventListener("click", openFromClick, true);
      document.removeEventListener("keydown", closeOnKey, true);
    };
  }, []);

  useEffect(() => {
    if (!src) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [src]);

  const close = useCallback(() => setSrc(null), []);

  // Keep a mounted anchor even when closed: a client component that renders
  // null during SSR has no DOM node to hydrate, so Next would skip its effects
  // and the document-level click listener would never attach.
  if (!src) return <span data-lightbox-anchor aria-hidden="true" />;

  return (
    <div ref={dialogRef} className={styles.lightbox} role="dialog" aria-modal="true" aria-label={alt || "Image preview"} onClick={close}>
      <button type="button" ref={closeRef} className={styles.lightboxClose} onClick={close} aria-label="Close image preview">
        <X size={20} aria-hidden="true" />
      </button>
      <img src={src} alt={alt} className={styles.lightboxImage} onClick={(event) => event.stopPropagation()} />
      {alt ? <span className={styles.lightboxCaption}>{alt}</span> : null}
    </div>
  );
}
