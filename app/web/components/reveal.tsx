"use client";

import { useEffect, useRef, useState } from "react";

export const revealViewportMargin = 40;
export const revealObserverOptions: IntersectionObserverInit = { threshold: [0, 0.12], rootMargin: `0px 0px -${revealViewportMargin}px` };

export function isWithinRevealViewport(element: Element): boolean {
  return element.getBoundingClientRect().top < window.innerHeight - revealViewportMargin;
}

export function Reveal({ children, className = "", manual = false }: { children: React.ReactNode; className?: string; manual?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (manual) {
      const handleScroll = () => {
        if (!isWithinRevealViewport(element)) return;
        setVisible(true);
        window.removeEventListener("scroll", handleScroll);
      };
      window.addEventListener("scroll", handleScroll, { passive: true });
      return () => window.removeEventListener("scroll", handleScroll);
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, revealObserverOptions);
    observer.observe(element);
    return () => observer.disconnect();
  }, [manual]);

  return <div ref={ref} className={className} data-revealed={visible}>{children}</div>;
}
