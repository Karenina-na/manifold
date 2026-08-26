"use client";

import { useId, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import styles from "../app/site.module.css";

type FloatingTooltipProps = {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  children: ReactNode;
  placement?: "top" | "bottom";
  interactive?: boolean;
  className?: string;
  dataAttribute?: "data-series-tooltip" | "data-contact-tooltip";
  id?: string;
};

type TooltipPosition = { top: number; left: number; transform: string };

function getPosition(anchor: HTMLElement, placement: "top" | "bottom"): TooltipPosition {
  const rect = anchor.getBoundingClientRect();
  const gap = 10;
  const viewportPadding = 12;
  const tooltipWidth = Math.min(320, window.innerWidth - viewportPadding * 2);
  const estimatedHeight = 180;
  const canFitBelow = rect.bottom + gap + estimatedHeight <= window.innerHeight - viewportPadding;
  const shouldPlaceTop = placement === "top" || (!canFitBelow && rect.top >= estimatedHeight + gap + viewportPadding);
  const top = shouldPlaceTop ? rect.top - gap : rect.bottom + gap;
  const transform = shouldPlaceTop ? "translate(-50%, -100%)" : "translateX(-50%)";
  const left = Math.min(window.innerWidth - viewportPadding - tooltipWidth / 2, Math.max(viewportPadding + tooltipWidth / 2, rect.left + rect.width / 2));
  return { top, left, transform };
}

export function FloatingTooltip({ anchorRef, open, children, placement = "bottom", interactive = false, className = "", dataAttribute, id }: FloatingTooltipProps) {
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const generatedId = useId();

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const updatePosition = () => {
      if (anchorRef.current) setPosition(getPosition(anchorRef.current, placement));
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, { passive: true });
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition);
    };
  }, [anchorRef, open, placement]);

  if (!open || !position) return null;

  return createPortal(
    <div
      className={`${styles.floatingTooltip} ${className}`}
      data-floating-tooltip
      {...(dataAttribute ? { [dataAttribute]: true } : {})}
      id={id ?? generatedId}
      role="tooltip"
      style={{ top: position.top, left: position.left, transform: position.transform, pointerEvents: interactive ? "auto" : "none" }}
    >
      {children}
    </div>,
    document.body,
  );
}
