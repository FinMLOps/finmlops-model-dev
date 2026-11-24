"use client";
import { type RefObject, useEffect, useRef, useState, useSyncExternalStore } from "react";

// a number that counts from its previous value to the new one (or from `start` the first time)
export function useCountTo(value: number, duration = 550, start = value) {
  const [shown, setShown] = useState(start);
  const from = useRef(start);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / duration), eased = 1 - (1 - k) ** 3;
      setShown(start + (value - start) * eased);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return shown;
}

export function Count({ value, fmt, from, duration }: { value: number; fmt: (v: number) => string; from?: number; duration?: number }) {
  return <>{fmt(useCountTo(value, duration, from))}</>;
}

const REDUCE = "(prefers-reduced-motion: reduce)";
const onMotion = (cb: () => void) => { const m = matchMedia(REDUCE); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); };
const onVisibility = (cb: () => void) => { document.addEventListener("visibilitychange", cb); return () => document.removeEventListener("visibilitychange", cb); };

// an animation plays only while its element is on screen, the tab is visible and the visitor allows motion
export function usePlayback(ref: RefObject<HTMLElement | null>) {
  const [inView, setInView] = useState(false);
  const [seen, setSeen] = useState(false); // has been on screen at least once
  const reduced = useSyncExternalStore(onMotion, () => matchMedia(REDUCE).matches, () => false);
  const visible = useSyncExternalStore(onVisibility, () => !document.hidden, () => true);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => { setInView(e.isIntersecting); if (e.isIntersecting) setSeen(true); }, { threshold: 0.35 });
    io.observe(ref.current!);
    return () => io.disconnect();
  }, [ref]);
  return { playing: inView && visible && !reduced, reduced, seen };
}
