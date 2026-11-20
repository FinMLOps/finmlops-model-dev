"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useApp } from "@/components/AppProvider";
import { HeadlineTable } from "@/components/HeadlineTable";
import { DailyChart } from "@/components/dashboard/DailyChart";
import { Pulse } from "@/components/dashboard/Pulse";
import { QuoteCard } from "@/components/dashboard/QuoteCard";
import { useApi } from "@/lib/api";
import { signed } from "@/lib/format";
import type { Article } from "@/lib/types";

const STEPS = [
  ["A champion model", "Train and register the first one (skip if you already have one)", "uv run python -m scripts.train baseline"],
  ["Headlines labeled by it", "Every article scored once and cached", "uv run python -m frontend.server score"],
  ["Stock prices (optional)", "Daily closes for the price overlay", "uv run python -m frontend.server prices"],
];

export default function Dashboard() {
  const { ov, ovError, ticker, setTouring } = useApp();
  const { data: rows, error } = useApi<Article[]>(ov ? `/api/headlines?ticker=${ticker}&limit=8` : null);
  const t = ov?.tickers.find(x => x.ticker === ticker);

  // first visit: offer the guided tour once the data is on screen
  useEffect(() => {
    if (!ov) return;
    let toured = true;
    try { toured = Boolean(localStorage.getItem("finmlops.toured")); } catch {}
    if (toured) return;
    const timer = setTimeout(() => setTouring(true), 600);
    return () => clearTimeout(timer);
  }, [ov, setTouring]);

  // the browser tab names the stock and its sentiment
  useEffect(() => { if (t) document.title = `${t.ticker} ${signed(t.week.net)} · FinMLOps`; }, [t]);

  if (ovError) {
    const unreachable = ovError.includes("isn't reachable");
    return (
      <div className="panel empty-state">
        <h2>{unreachable ? "Can't reach the API server" : "Almost there: no predictions to show yet"}</h2>
        <p>{ovError}</p>
        {unreachable ? <pre>uv run python -m frontend.server</pre> : (
          <ol className="setup">{STEPS.map(([title, hint, cmd], i) => (
            <li key={i}><span className="mark-no">{i + 1}</span><div><b>{title}</b><span className="h">{hint}</span></div><code>{cmd}</code></li>
          ))}</ol>
        )}
        <p className="muted">Then refresh this page.</p>
      </div>
    );
  }

  return (
    <>
      <QuoteCard />
      <div className="grid"><DailyChart /></div>
      <Pulse />
      <div className="panel headlines-panel">
        <div className="panel-head">Latest headlines <span className="muted">{ov ? ticker : ""}</span>
          <div className="head-right"><Link className="link-btn" href="/news">View all →</Link></div>
        </div>
        <HeadlineTable rows={rows} error={error} id="tbl-dash" />
      </div>
    </>
  );
}
