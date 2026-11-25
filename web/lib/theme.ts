"use client";
import { useEffect, useState } from "react";

// colour helpers with no chart library behind them, so pages without a Chart.js chart (Analyzer, home) don't load it

export function alpha(hex: string, a: number) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// the theme's positive / negative colours, re-read whenever the theme changes
export function useSentimentColors() {
  const [colors, setColors] = useState({ positive: "#22b07d", negative: "#ef4f58" });
  useEffect(() => {
    const read = () => {
      const s = getComputedStyle(document.documentElement);
      setColors({ positive: s.getPropertyValue("--pos").trim(), negative: s.getPropertyValue("--neg").trim() });
    };
    read();
    addEventListener("themechange", read);
    return () => removeEventListener("themechange", read);
  }, []);
  return colors;
}
