"use client";
import { Chart, type ChartConfiguration } from "chart.js";
import { useEffect, useRef } from "react";

// a Chart.js chart that morphs to new data (so it animates instead of redrawing) and is rebuilt when themeKey changes
export function ChartCanvas({ config, themeKey }: { config: ChartConfiguration; themeKey: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart | null>(null);
  const latest = useRef(config);

  useEffect(() => { latest.current = config; });

  useEffect(() => {
    const c = new Chart(canvas.current!, latest.current);
    chart.current = c;
    return () => { c.destroy(); chart.current = null; };
  }, [themeKey]);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    c.data.labels = config.data.labels;
    if (c.data.datasets.length === config.data.datasets.length) config.data.datasets.forEach((d, i) => Object.assign(c.data.datasets[i], d));
    else c.data.datasets = config.data.datasets;
    c.options = config.options ?? {};
    c.update();
  }, [config]);

  return <canvas ref={canvas} />;
}
