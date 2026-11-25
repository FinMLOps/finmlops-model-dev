"use client";
import {
  BarController, BarElement, CategoryScale, Chart, Filler, Legend, LinearScale, LineController, LineElement, PointElement,
  Tooltip, type Plugin,
} from "chart.js";
import { useEffect, useState } from "react";
import { alpha } from "./theme";

// only the parts our three charts use (daily sentiment line, volume bars, accuracy bars), not all of Chart.js
Chart.register(LineController, LineElement, PointElement, BarController, BarElement, CategoryScale, LinearScale,
  Filler, Tooltip, Legend);

export { alpha };

export type Colors = Record<"positive" | "neutral" | "negative" | "accent" | "price" | "grid" | "muted" | "faint" | "text" | "panel" | "border2" | "tooltip", string>;

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// read the theme's colours and point Chart.js's defaults at them
function readColors(): Colors {
  const C: Colors = {
    positive: css("--pos"), neutral: css("--neu"), negative: css("--neg"), accent: css("--accent"), price: css("--price"),
    grid: css("--border"), muted: css("--muted"), faint: css("--faint"), text: css("--text"), panel: css("--panel"),
    border2: css("--border-2"), tooltip: css("--tooltip"),
  };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  Chart.defaults.color = C.muted;
  Chart.defaults.borderColor = C.grid;
  Chart.defaults.font.family = css("--sans");
  Chart.defaults.font.size = 11;
  Chart.defaults.maintainAspectRatio = false;
  // update in place: Chart.js reads the option names (type, fn, …) from this object, so replacing it breaks colour
  // animations ("this._fn is not a function" when the High/Low point colours move after switching stocks)
  Object.assign(Chart.defaults.animation, { duration: reduced ? 0 : 550, easing: "easeOutQuart" });
  Object.assign(Chart.defaults.plugins.legend.labels, { boxWidth: 8, boxHeight: 8, usePointStyle: true, padding: 14 });
  Object.assign(Chart.defaults.plugins.tooltip, {
    backgroundColor: C.tooltip, borderColor: C.border2, borderWidth: 1, titleColor: C.text, bodyColor: C.muted,
    padding: 10, cornerRadius: 4, boxPadding: 4,
  });
  return C;
}

// the theme's colours, re-read whenever the theme changes; `key` changes with them so charts get rebuilt
export function useChartColors() {
  const [state, setState] = useState<{ C: Colors | null; key: number }>({ C: null, key: 0 });
  useEffect(() => {
    const update = () => setState(s => ({ C: readColors(), key: s.key + 1 }));
    update();
    addEventListener("themechange", update);
    return () => removeEventListener("themechange", update);
  }, []);
  return state;
}

// dashed vertical line under the cursor
export const crosshair: Plugin = {
  id: "crosshair",
  afterDatasetsDraw(chart) {
    const active = chart.tooltip?.getActiveElements() ?? [];
    if (!active.length) return;
    const x = active[0].element.x, { top, bottom } = chart.chartArea, ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(230, 233, 239, .22)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
  },
};

// small "High" / "Low" labels next to marked points (options.plugins.markers.points = [{i, text, color, above}])
type Marker = { i: number; text: string; color: string; above: boolean };
export const markers: Plugin = {
  id: "markers",
  afterDatasetsDraw(chart, _args, opts: { points?: Marker[] }) {
    const meta = chart.getDatasetMeta(0);
    if (!opts?.points || meta.hidden) return;
    const ctx = chart.ctx;
    ctx.save();
    ctx.font = `600 10.5px ${css("--sans")}`;
    ctx.textAlign = "center";
    opts.points.forEach(({ i, text, color, above }) => {
      const p = meta.data[i];
      if (!p) return;
      ctx.fillStyle = color;
      ctx.fillText(text, p.x, above ? p.y - 11 : p.y + 19);
    });
    ctx.restore();
  },
};
