"use client";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/Logo";
import { Win } from "@/components/home/Feature";
import { useOverview } from "@/lib/api";
import { day, signed, tone, weekMove } from "@/lib/format";
import { Count, usePlayback } from "@/lib/motion";

// real data: the same overview the dashboard reads, for a few stocks in turn
const SHOW = ["NVDA", "TSLA", "AAPL"], DAYS = 30, CYCLE = 5500;
const W = 300, H = 120, PAD = 10; // the chart's own units; it stretches to the window's width

export function DashboardDemo() {
  const { data, error } = useOverview();
  const box = useRef<HTMLDivElement>(null);
  const { playing } = usePlayback(box);
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true); // cycle until the visitor picks a stock
  const t = data?.tickers.find(x => x.ticker === SHOW[i]);

  useEffect(() => {
    if (!playing || !auto) return;
    const id = setTimeout(() => setI(n => (n + 1) % SHOW.length), CYCLE);
    return () => clearTimeout(id);
  }, [playing, auto, i]);

  const rows = t?.daily.slice(-DAYS) ?? [];
  const bw = W / Math.max(1, rows.length), mid = H / 2;
  const max = Math.max(1, ...rows.map(r => Math.abs(r.net)));
  const closes = rows.flatMap((r, k) => (r.close == null ? [] : [{ k, c: r.close }]));
  const lo = Math.min(...closes.map(p => p.c)), hi = Math.max(...closes.map(p => p.c));
  const price = closes.map(p => `${(p.k + 0.5) * bw},${PAD + (1 - (p.c - lo) / (hi - lo || 1)) * (H - 2 * PAD)}`).join(" ");
  const move = t && weekMove(t);

  return (
    <Win title="dashboard">
      <div className="dm" ref={box}>
        <div className="dm-top">
          <div className="seg">
            {SHOW.map((s, k) => <button key={s} className={k === i ? "active" : ""} onClick={() => { setAuto(false); setI(k); }}>{s}</button>)}
          </div>
          {data && <span className="dm-asof">data through {day(data.as_of.slice(0, 10))}</span>}
        </div>
        {error ? <p className="dm-empty">Couldn&apos;t load the market data.</p> : !t ? <div className="dm-empty"><span className="sk" style={{ width: "100%", height: 190 }} /></div> : (
          <>
            <div className="dm-head">
              <Logo ticker={t.ticker} />
              <div className="dm-name"><b>{t.ticker}</b><span>{t.name}</span></div>
              <div className="dm-stat"><span className="label">Net sentiment · 7d</span><b className={`num ${tone(t.week.net)}`}><Count value={t.week.net} fmt={v => signed(v)} /></b></div>
              {move && <div className="dm-stat"><span className="label">Close · 1w</span><b className="num">${move.close.toFixed(2)} <small className={tone(move.change)}>{signed(move.change)}%</small></b></div>}
            </div>
            <svg className="dm-chart" key={t.ticker} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label={`${t.ticker}: daily net sentiment and closing price, last ${rows.length} days`}>
              <line className="dm-zero" x1="0" x2={W} y1={mid} y2={mid} />
              {rows.map((r, k) => {
                const h = (Math.abs(r.net) / max) * (mid - 4);
                return <rect key={r.date} className={r.net >= 0 ? "up" : "down"} x={k * bw + bw * 0.18} width={bw * 0.64} y={r.net >= 0 ? mid - h : mid} height={h} style={{ "--i": k } as React.CSSProperties} />;
              })}
              {closes.length > 1 && <polyline className="dm-line" points={price} />}
            </svg>
            <div className="dm-axis">
              <span>{day(rows[0].date)}</span>
              <span className="dm-legend"><i className="up" />daily net sentiment<i className="line" />close</span>
              <span>{day(rows[rows.length - 1].date)}</span>
            </div>
          </>
        )}
      </div>
    </Win>
  );
}
