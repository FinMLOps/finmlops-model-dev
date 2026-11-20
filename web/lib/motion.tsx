"use client";
import { useEffect, useRef, useState } from "react";

// a number that counts from its previous value to the new one
export function useCountTo(value: number, duration = 550) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
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

export function Count({ value, fmt }: { value: number; fmt: (v: number) => string }) {
  return <>{fmt(useCountTo(value))}</>;
}
