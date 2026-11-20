import type { Day, Ticker } from "./types";

export const TICKERS = ["AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN", "TSLA"];
export const LABELS = ["positive", "neutral", "negative"] as const;

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const tone = (x: number) => (x > 0 ? "up" : x < 0 ? "down" : "flat");
export const arrow = (x: number) => (x > 0 ? "▲" : x < 0 ? "▼" : "•");
export const signed = (x: number, d = 1) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(d);
export const pct = (a: number, n: number) => (n ? (100 * a) / n : 0);
export const f3 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(3));
export const day = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function when(iso: string | number) {
  const d = new Date(iso), mins = (Date.now() - d.getTime()) / 60000;
  if (mins < 60) return `${Math.max(1, Math.round(mins))}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" });
  return `${date} ${time}`;
}

// last close and its change vs the last close at least a week earlier
export function weekMove(t: Ticker) {
  const closes = t.daily.filter((d): d is Day & { close: number } => d.close != null);
  if (closes.length < 2) return null;
  const last = closes[closes.length - 1];
  const cut = new Date(new Date(last.date).getTime() - 7 * 864e5).toISOString().slice(0, 10);
  const ref = [...closes].reverse().find(d => d.date <= cut) ?? closes[0];
  return { close: last.close, change: (last.close / ref.close - 1) * 100 };
}
