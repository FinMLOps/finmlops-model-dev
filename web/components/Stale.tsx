"use client";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";

// a market product must never pass old sentiment off as current
export function Stale() {
  const { ov } = useApp();
  const [state, setState] = useState<{ hidden: boolean; hours: number }>({ hidden: true, hours: 0 });
  useEffect(() => {
    if (!ov) return;
    const hours = (Date.now() - new Date(ov.as_of).getTime()) / 36e5;
    let dismissed = false;
    try { dismissed = sessionStorage.getItem("finmlops.stale") === ov.as_of; } catch {}
    setState({ hidden: hours < 24 || dismissed, hours }); // eslint-disable-line react-hooks/set-state-in-effect -- needs the clock and sessionStorage
  }, [ov]);
  const { hidden, hours } = state;
  if (!ov || hidden) return null;
  const daysOld = Math.floor(hours / 24);
  return (
    <div className="stale" role="status">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l6.5 12h-13z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M8 6v3.5M8 11.5v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      <span><b>Data is out of date.</b> The newest article is {daysOld} day{daysOld === 1 ? "" : "s"} old, so this isn&apos;t current sentiment. Run the data pipeline, then <code>python -m frontend.server score</code>.</span>
      <button className="stale-x" type="button" aria-label="Dismiss" title="Dismiss" onClick={() => {
        setState(st => ({ ...st, hidden: true }));
        try { sessionStorage.setItem("finmlops.stale", ov.as_of); } catch {}
      }}>✕</button>
    </div>
  );
}
