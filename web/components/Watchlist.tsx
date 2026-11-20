"use client";
import { useApp } from "@/components/AppProvider";
import { Logo } from "@/components/Logo";
import { signed, TICKERS, tone } from "@/lib/format";
import type { Day } from "@/lib/types";

export const change = (t: { week: { net: number }; prev: { net: number } }) => t.week.net - t.prev.net;

function Spark({ daily }: { daily: Day[] }) {
  const v = daily.slice(-14).map(d => d.net);
  if (v.length < 2) return <span />;
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((val, i) => `${((i / (v.length - 1)) * 56).toFixed(1)},${(21 - ((val - min) / span) * 20).toFixed(1)}`).join(" ");
  const t = tone(v[v.length - 1] - v[0]);
  return (
    <svg className="spark" viewBox="0 0 56 22" preserveAspectRatio="none">
      <polygon className={t} points={`0,22 ${pts} 56,22`} /><polyline className={t} points={pts} />
    </svg>
  );
}

export function Watchlist() {
  const { ov, ovError, ticker, selectTicker } = useApp();
  const asOf = ov && new Date(ov.as_of).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <aside className="panel watchlist">
      <div className="panel-head">Watchlist <span className="muted">7 tech stocks</span></div>
      <div className="wl-row wl-cols"><span>Ticker</span><span>14D</span><span className="r">Net 7D</span><span className="r">Chg</span></div>
      <ul id="watchlist">
        {ovError && <li className="wl-empty">No data yet.</li>}
        {!ovError && (ov ? ov.tickers.map(t => (
          <li key={t.ticker} className={`wl-row wl-item ${t.ticker === ticker ? "active" : ""}`} onClick={() => selectTicker(t.ticker)}>
            <div className="wl-id"><Logo ticker={t.ticker} /><div><b>{t.ticker}</b><span>{t.name}</span></div></div>
            <Spark daily={t.daily} />
            <span className={`num ${tone(t.week.net)}`}>{signed(t.week.net)}</span>
            <span className={`num ${tone(change(t))}`}>{signed(change(t))}</span>
          </li>
        )) : TICKERS.map(t => (
          <li key={t} className="wl-row wl-item">
            <div className="wl-id"><Logo ticker={t} /><div><b>{t}</b><span className="sk" style={{ width: 54 }} /></div></div>
            <span className="sk lg" style={{ width: 56 }} /><span className="r"><span className="sk" style={{ width: 38 }} /></span><span className="r"><span className="sk" style={{ width: 34 }} /></span>
          </li>
        )))}
      </ul>
      <p className="wl-foot">Net sentiment = % positive − % negative articles, labeled by the champion model. Change is vs the 7 days before.</p>
      {ov && <p className="wl-foot wl-asof">Data as of {asOf} · scored by v{ov.scored_by}</p>}
    </aside>
  );
}
