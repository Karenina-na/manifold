"use client";

import { useEffect, useRef, useState } from "react";

export const revealObserverOptions: IntersectionObserverInit = { threshold: [0, 0.12], rootMargin: "0px 0px -40px" };

export function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, revealObserverOptions);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <div ref={ref} className={className} data-revealed={visible}>{children}</div>;
}
