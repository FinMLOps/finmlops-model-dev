"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Logo } from "@/components/Logo";
import { day, LABELS, pct, signed, TICKERS, tone } from "@/lib/format";
import type { Day } from "@/lib/types";

const DAYS = 14;
const FULL = 60; // |net| at which a cell reaches full colour
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// every ticker x the last 14 days, coloured by net sentiment; hover for details, click for that day's headlines
export function Pulse() {
  const { ov, ticker, selectTicker, openDrawer, toast } = useApp();
  const panel = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ t: string; r: Day; cell: DOMRect } | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // place the tooltip above the cell (or below if there's no room), inside the panel
  useLayoutEffect(() => {
    if (!tip || !panel.current || !tipRef.current) return;
    const p = panel.current.getBoundingClientRect(), w = tipRef.current.offsetWidth, h = tipRef.current.offsetHeight, c = tip.cell;
    const x = Math.max(8, Math.min(c.left - p.left + c.width / 2 - w / 2, p.width - w - 8));
    const above = c.top - p.top - h - 10;
    setPos({ x, y: above > 0 ? above : c.bottom - p.top + 10 });
  }, [tip]);

  const dates = ov ? [...new Set(ov.tickers.flatMap(t => t.daily.map(d => d.date)))].sort().slice(-DAYS) : [];
  const open = (t: string, r: Day) => {
    setTip(null);
    if (ticker !== t) selectTicker(t);
    const list = [r.top_positive, r.top_negative].filter(a => a != null);
    if (list.length) openDrawer(list, r.net < 0 && r.top_negative ? list.indexOf(r.top_negative) : 0);
    else toast(`No headlines for ${t} on ${day(r.date)}.`);
  };
  const top = tip && (tip.r.top_positive || tip.r.top_negative);

  return (
    <div className="panel pulse-panel" ref={panel}>
      <div className="panel-head">Market pulse <span className="muted">net sentiment by day, last 14 days</span>
        <div className="head-right pulse-legend" aria-hidden="true"><span>Negative</span><i /><span>Positive</span></div>
      </div>
      <div className="pulse" style={{ "--n": dates.length || DAYS } as React.CSSProperties} onMouseLeave={() => setTip(null)}>
        {!ov ? TICKERS.map(t => <div className="pulse-row" key={t}><span className="sk lg" style={{ width: 72 }} /><span className="sk" style={{ width: "100%", height: 26 }} /></div>) : <>
          <div className="pulse-row pulse-head">
            <span />
            {dates.map((d, i) => {
              const date = new Date(d + "T00:00:00Z"), n = date.getUTCDate();
              const month = i === 0 || n === 1 ? date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) : "";
              return <span key={d}>{month && <em>{month}</em>}{n}</span>;
            })}
          </div>
          {ov.tickers.map(t => {
            const by = Object.fromEntries(t.daily.map(r => [r.date, r]));
            return (
              <div key={t.ticker} className={`pulse-row ${t.ticker === ticker ? "active" : ""}`}>
                <button className="pulse-tkr" type="button" onClick={() => selectTicker(t.ticker)}><Logo ticker={t.ticker} /><b>{t.ticker}</b></button>
                {dates.map((d, i) => {
                  const r = by[d];
                  if (!r) return <span key={d} className="cell none" />;
                  const show = (e: React.SyntheticEvent<HTMLElement>) => setTip({ t: t.ticker, r, cell: e.currentTarget.getBoundingClientRect() });
                  return (
                    <button key={d} type="button" className={`cell ${tone(r.net)}`}
                      style={{ "--v": Math.min(1, Math.abs(r.net) / FULL).toFixed(2), "--i": i } as React.CSSProperties}
                      aria-label={`${t.ticker}, ${day(d)}: net ${signed(r.net)}, ${r.articles} articles`}
                      onMouseEnter={show} onFocus={show} onBlur={() => setTip(null)} onClick={() => open(t.ticker, r)}>
                      <span className="num">{signed(Math.round(r.net), 0)}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </>}
      </div>
      {tip && (
        <div className="pulse-tip" ref={tipRef} style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
          <div className="pt-head"><Logo ticker={tip.t} /><b>{tip.t}</b><span className="muted">{day(tip.r.date)}</span></div>
          <div className={`pt-net num ${tone(tip.r.net)}`}>{signed(tip.r.net)} <span className="muted">net</span></div>
          <div className="pt-mix">{LABELS.map(l => <span key={l} className={`bg-${l}`} style={{ width: `${pct(tip.r[l], tip.r.articles)}%` }} />)}</div>
          <div className="pt-row muted"><span>{tip.r.articles} articles</span><span>{pct(tip.r.positive, tip.r.articles).toFixed(0)}% pos · {pct(tip.r.negative, tip.r.articles).toFixed(0)}% neg</span></div>
          {top && <><div className="pt-hl">{trunc(top.title, 90)}</div><div className="pt-foot">Click to read the day&apos;s top headlines</div></>}
        </div>
      )}
    </div>
  );
}
