"use client";
import { useApp } from "@/components/AppProvider";
import { Logo } from "@/components/Logo";
import { change } from "@/components/Watchlist";
import { arrow, cap, LABELS, pct, signed, tone, when } from "@/lib/format";
import { Count } from "@/lib/motion";

const mood = (net: number) =>
  net >= 15 ? ["Bullish", "up"] : net >= 5 ? ["Leaning positive", "up"] : net <= -15 ? ["Bearish", "down"]
    : net <= -5 ? ["Leaning negative", "down"] : ["Mixed", "flat"];

export function QuoteCard() {
  const { ov, ticker } = useApp();
  const t = ov?.tickers.find(x => x.ticker === ticker);
  if (!t) {
    return (
      <div className="panel quote">
        <div className="quote-id"><span className="sk" style={{ width: 46, height: 46 }} /><div><span className="sk lg" style={{ width: 76 }} /></div></div>
        <div className="quote-main"><span className="sk xl" style={{ width: 160 }} /></div>
        <div className="quote-mix"><span className="sk" style={{ width: "100%" }} /></div>
        <div className="quote-stats">{Array.from({ length: 5 }, (_, i) => <div className="stat" key={i}><span className="sk" style={{ width: 64 }} /><span className="sk lg" style={{ width: 48 }} /></div>)}</div>
      </div>
    );
  }
  const w = t.week, d = change(t), [moodText, moodTone] = mood(w.net);
  const int = (v: number) => Math.round(v).toLocaleString("en-US");
  return (
    <div className="panel quote" data-mood={tone(w.net)}>
      <div className="quote-id fade-in" key={t.ticker}>
        <Logo ticker={t.ticker} size="lg" />
        <div><div className="sym">{t.ticker}</div><div className="name">{t.name}</div></div>
      </div>
      <div className="quote-main">
        <div className="gauge" style={{ "--a": `${Math.max(-1, Math.min(1, w.net / 100)) * 90}deg` } as React.CSSProperties} aria-hidden="true">
          <svg viewBox="0 0 100 58">
            <defs><linearGradient id="g-arc" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" style={{ stopColor: "var(--neg)" }} /><stop offset=".5" style={{ stopColor: "var(--neu)" }} /><stop offset="1" style={{ stopColor: "var(--pos)" }} />
            </linearGradient></defs>
            <path className="g-track" d="M10 50 A40 40 0 0 1 90 50" />
            <path className="g-arc" d="M10 50 A40 40 0 0 1 90 50" />
            <g className="g-needle"><line x1="50" y1="50" x2="50" y2="17" /><circle cx="50" cy="50" r="4.5" /></g>
          </svg>
        </div>
        <div className={`big num ${tone(w.net)}`}><Count value={w.net} fmt={v => signed(v)} /></div>
        <div className="quote-sub">
          <span><span className={`chip ${tone(d)}`}>{arrow(d)} {signed(d)} vs prior 7D</span></span>
          <span className="label">Net sentiment · 7D</span>
        </div>
      </div>
      <div className="quote-mix">
        <div className="qm-head"><span className="label">News mix · 7D</span><span className={`qm-mood ${moodTone}`}>{moodText}</span></div>
        <div className="mixbar" aria-hidden="true">{LABELS.map(l => <span key={l} className={`bg-${l}`} style={{ width: `${pct(w[l], w.articles)}%` }} />)}</div>
        <div className="qm-legend">{LABELS.map(l => <span key={l}><i className={`bg-${l}`} />{cap(l)} {pct(w[l], w.articles).toFixed(0)}%</span>)}</div>
      </div>
      <div className="quote-stats">
        <div className="stat"><span className="label">Articles 7D</span><span className="v num"><Count value={w.articles} fmt={int} /></span><span className="h">prior {t.prev.articles}</span></div>
        {LABELS.map(l => (
          <div className="stat" key={l}><span className="label">{cap(l)}</span><span className="v num"><Count value={pct(w[l], w.articles)} fmt={v => `${v.toFixed(0)}%`} /></span><span className="h">{w[l]} articles</span></div>
        ))}
        <div className="stat"><span className="label">Last article</span><span className="v num">{when(t.latest_at)}</span><span className="h" /></div>
      </div>
    </div>
  );
}
