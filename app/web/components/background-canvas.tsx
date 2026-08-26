"use client";

import { useEffect, useRef } from "react";

const GRID_GAP = 20;

export function BackgroundCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let frame = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pointer = { x: -9999, y: -9999, targetX: -9999, targetY: -9999, vx: 0, vy: 0 };
    const ripples: Array<{ x: number; y: number; birth: number; maxRadius: number; speed: number; amplitude: number }> = [];

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const onPointerMove = (event: PointerEvent) => {
      pointer.targetX = event.clientX;
      pointer.targetY = event.clientY;
    };
    const onPointerLeave = () => {
      pointer.targetX = -1000;
      pointer.targetY = -1000;
    };
    const onPointerDown = (event: PointerEvent) => {
      ripples.push({ x: event.clientX, y: event.clientY, birth: performance.now(), maxRadius: 280, speed: 0.18, amplitude: 8 });
    };
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionChange = (event: MediaQueryListEvent) => { reducedMotion = event.matches; };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    motionQuery.addEventListener("change", onMotionChange);

    const render = (timestamp: number) => {
      context.clearRect(0, 0, width, height);
      const dark = document.documentElement.dataset.theme === "dark";
      const time = reducedMotion ? 0 : timestamp * 0.00038;
      const prevX = pointer.x;
      const prevY = pointer.y;
      pointer.x += (pointer.targetX - pointer.x) * 0.08;
      pointer.y += (pointer.targetY - pointer.y) * 0.08;
      pointer.vx = pointer.x - prevX;
      pointer.vy = pointer.y - prevY;

      for (let index = ripples.length - 1; index >= 0; index -= 1) {
        const age = (timestamp - ripples[index].birth) * ripples[index].speed;
        if (age > ripples[index].maxRadius) ripples.splice(index, 1);
      }

      for (let x = 0; x <= width + GRID_GAP; x += GRID_GAP) {
        for (let y = 0; y <= height + GRID_GAP; y += GRID_GAP) {
          const horizontalDistance = Math.min(1, Math.abs(x - width * 0.5) / Math.max(1, width * 0.5));
          const focus = 0.28 + 0.72 * Math.pow(1 - horizontalDistance, 1.15);
          const waveX = Math.sin(y * 0.018 + time * 1.3) * Math.cos(x * 0.003 + time * 0.45);
          const waveY = Math.cos(x * 0.015 - time * 0.95) * Math.sin(y * 0.0035 + time * 0.55);
          const ambientDrift = Math.sin(time * 0.34) * 0.7 + Math.sin(time * 0.19 + 1.2) * 0.35;
          const restingPulse = (Math.sin(x * 0.006 + y * 0.004 + time * 1.15) + 1) * 0.5;
          const dx = x - pointer.x;
          const dy = y - pointer.y;
          const distance = Math.hypot(dx, dy);
          const influence = distance < 200 ? Math.pow(1 - (distance / 200) ** 2, 3) : 0;
          const sideBias = pointer.x > -1000 ? Math.min(1, Math.abs(pointer.x - width * 0.5) / Math.max(1, width * 0.5)) : 0;
          const lensInfluence = influence * (0.38 + sideBias * 0.62);
          let offsetX = waveX * 4.2 + ambientDrift * focus;
          let offsetY = waveY * 3.6 + Math.cos(time * 0.27) * 1.4 * focus;
          let highlight = focus * restingPulse * 0.08 + lensInfluence * 0.95;
          if (lensInfluence && distance) {
            offsetX += (dx / distance) * lensInfluence * 12 + pointer.vx * lensInfluence * 0.35;
            offsetY += (dy / distance) * lensInfluence * 12 + pointer.vy * lensInfluence * 0.35;
          }
          for (const ripple of ripples) {
            const rippleDistance = Math.hypot(x - ripple.x, y - ripple.y);
            const waveRadius = (timestamp - ripple.birth) * ripple.speed;
            const envelope = Math.exp(-(((rippleDistance - waveRadius) / 36) ** 2));
            const displacement = Math.sin((rippleDistance - waveRadius) * 0.08) * envelope * Math.max(0, 1 - waveRadius / ripple.maxRadius) * ripple.amplitude;
            if (Math.abs(displacement) > 0.05) {
              const angle = Math.atan2(y - ripple.y, x - ripple.x);
              offsetX += Math.cos(angle) * displacement;
              offsetY += Math.sin(angle) * displacement;
              highlight += Math.max(0, displacement * 0.1);
            }
          }
          const ink = dark ? "255,255,255" : "0,0,0";
          const accent = dark ? "226,114,91" : "217,93,57";
          context.beginPath();
          context.arc(x + offsetX, y + offsetY, Math.max(0.85, 1.35 + lensInfluence * 0.9), 0, Math.PI * 2);
          const alpha = Math.min(0.9, (dark ? 0.31 : 0.37) * focus * (0.88 + restingPulse * 0.2) + highlight * 0.48);
          context.fillStyle = highlight > 0.1 ? `rgba(${accent}, ${alpha})` : `rgba(${ink}, ${alpha})`;
          context.fill();
        }
      }
      if (!reducedMotion) frame = window.requestAnimationFrame(render);
    };

    frame = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("pointerdown", onPointerDown);
      motionQuery.removeEventListener("change", onMotionChange);
    };
  }, []);

  return <canvas ref={canvasRef} className="backgroundCanvas" data-manifold-physics="lens-grid" aria-hidden="true" />;
}
