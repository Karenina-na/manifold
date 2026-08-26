"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import styles from "../app/site.module.css";

export type TooltipPlacement = "top" | "bottom" | "left" | "right";

type FloatingTooltipProps = {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  children: ReactNode;
  placement?: TooltipPlacement;
  offset?: number;
  showArrow?: boolean;
  interactive?: boolean;
  className?: string;
  dataAttribute?: "data-series-tooltip" | "data-contact-tooltip" | string;
  id?: string;
};

type PositionState = {
  top: number;
  left: number;
  actualPlacement: TooltipPlacement;
  arrowOffset?: { left?: number; top?: number };
};

const VIEWPORT_PADDING = 8;
const ARROW_SIZE = 6;

export function FloatingTooltip({
  anchorRef,
  open,
  children,
  placement = "bottom",
  offset = 8,
  showArrow = true,
  interactive = false,
  className = "",
  dataAttribute,
  id,
}: FloatingTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<PositionState | null>(null);

  const tooltipRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const tooltipId = id ?? generatedId;

  // 动画入场/退场过渡状态管理
  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    } else {
      const timer = setTimeout(() => setVisible(false), 150); // 配合 CSS 动画时长
      return () => clearTimeout(timer);
    }
  }, [open]);

  // 精准坐标计算
  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) return;

    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const totalOffset = offset + (showArrow ? ARROW_SIZE : 0);

    let targetPlacement = placement;

    // 边界碰撞检测与自动翻转
    if (placement === "top" && anchorRect.top - tooltipRect.height - totalOffset < VIEWPORT_PADDING) {
      targetPlacement = "bottom";
    } else if (placement === "bottom" && anchorRect.bottom + tooltipRect.height + totalOffset > window.innerHeight - VIEWPORT_PADDING) {
      targetPlacement = "top";
    } else if (placement === "left" && anchorRect.left - tooltipRect.width - totalOffset < VIEWPORT_PADDING) {
      targetPlacement = "right";
    } else if (placement === "right" && anchorRect.right + tooltipRect.width + totalOffset > window.innerWidth - VIEWPORT_PADDING) {
      targetPlacement = "left";
    }

    let top = 0;
    let left = 0;

    // 主坐标计算
    if (targetPlacement === "top" || targetPlacement === "bottom") {
      top = targetPlacement === "top"
        ? anchorRect.top - tooltipRect.height - totalOffset + scrollY
        : anchorRect.bottom + totalOffset + scrollY;

      // 水平居中并限制在视口边界内
      const idealLeft = anchorRect.left + (anchorRect.width - tooltipRect.width) / 2;
      const clampedLeft = Math.max(
        VIEWPORT_PADDING,
        Math.min(window.innerWidth - tooltipRect.width - VIEWPORT_PADDING, idealLeft)
      );
      left = clampedLeft + scrollX;
    } else {
      left = targetPlacement === "left"
        ? anchorRect.left - tooltipRect.width - totalOffset + scrollX
        : anchorRect.right + totalOffset + scrollX;

      // 垂直居中并限制在视口边界内
      const idealTop = anchorRect.top + (anchorRect.height - tooltipRect.height) / 2;
      const clampedTop = Math.max(
        VIEWPORT_PADDING,
        Math.min(window.innerHeight - tooltipRect.height - VIEWPORT_PADDING, idealTop)
      );
      top = clampedTop + scrollY;
    }

    // 计算指示箭头相对位置（精确指向 Anchor 中心）
    const arrowOffset: { left?: number; top?: number } = {};
    if (showArrow) {
      if (targetPlacement === "top" || targetPlacement === "bottom") {
        const anchorCenter = anchorRect.left + anchorRect.width / 2 + scrollX;
        arrowOffset.left = Math.max(
          12,
          Math.min(tooltipRect.width - 12, anchorCenter - left)
        );
      } else {
        const anchorCenter = anchorRect.top + anchorRect.height / 2 + scrollY;
        arrowOffset.top = Math.max(
          12,
          Math.min(tooltipRect.height - 12, anchorCenter - top)
        );
      }
    }

    setPosition({
      top,
      left,
      actualPlacement: targetPlacement,
      arrowOffset,
    });
  }, [anchorRef, offset, placement, showArrow]);

  useLayoutEffect(() => {
    if (!visible) return;

    updatePosition();

    const handleScrollAndResize = () => updatePosition();
    window.addEventListener("scroll", handleScrollAndResize, { passive: true });
    window.addEventListener("resize", handleScrollAndResize);

    const resizeObserver = new ResizeObserver(updatePosition);
    if (anchorRef.current) resizeObserver.observe(anchorRef.current);
    if (tooltipRef.current) resizeObserver.observe(tooltipRef.current);

    return () => {
      window.removeEventListener("scroll", handleScrollAndResize);
      window.removeEventListener("resize", handleScrollAndResize);
      resizeObserver.disconnect();
    };
  }, [visible, updatePosition, anchorRef]);

  if (typeof document === "undefined" || !visible) return null;

  return createPortal(
    <div
      ref={tooltipRef}
      id={tooltipId}
      role="tooltip"
      aria-hidden={!open}
      data-state={open ? "open" : "closed"}
      data-placement={position?.actualPlacement ?? placement}
      data-floating-tooltip
      {...(dataAttribute ? { [dataAttribute]: true } : {})}
      className={`${styles.floatingTooltip} ${className}`}
      style={{
        position: "absolute",
        top: `${position?.top ?? 0}px`,
        left: `${position?.left ?? 0}px`,
        pointerEvents: interactive ? "auto" : "none",
        visibility: position ? "visible" : "hidden",
      }}
    >
      <div className={styles.tooltipInner}>
        {children}
      </div>

      {showArrow && position?.arrowOffset && (
        <span
          className={styles.tooltipArrow}
          data-placement={position.actualPlacement}
          style={{
            left: position.arrowOffset.left !== undefined ? `${position.arrowOffset.left}px` : undefined,
            top: position.arrowOffset.top !== undefined ? `${position.arrowOffset.top}px` : undefined,
          }}
        />
      )}
    </div>,
    document.body
  );
}
