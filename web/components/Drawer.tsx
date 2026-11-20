"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnalysisBody, AnalysisSkeleton, type Prediction } from "@/components/Analysis";
import { useApp } from "@/components/AppProvider";
import { Logo } from "@/components/Logo";
import { api } from "@/lib/api";
import { cap, when } from "@/lib/format";

export const predict = (text: string) =>
  api<Prediction>("/api/predict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });

// the headline detail panel: the article, the model's label, and which words drove it
export function Drawer() {
  const { drawer, closeDrawer, setDrawerIdx } = useApp();
  const router = useRouter();
  const close = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{ key: string; r?: Prediction; error?: string } | null>(null);
  const r = drawer?.rows[drawer.idx];
  const key = r ? `${r.id}|${r.ticker}` : "";

  useEffect(() => {
    if (!r) return;
    let live = true;
    predict(r.text || r.title).then(
      res => live && setResult({ key, r: res }),
      e => live && setResult({ key, error: e.message }),
    );
    body.current?.scrollTo(0, 0);
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- r changes with key

  useEffect(() => {
    document.body.style.overflow = drawer ? "hidden" : "";
    if (drawer) setTimeout(() => close.current?.focus({ preventScroll: true }), 60);
  }, [drawer]);

  const open = Boolean(r);
  const n = drawer?.rows.length ?? 0, idx = drawer?.idx ?? 0;
  const mine = result?.key === key ? result : null;

  return (
    <>
      <div className={`drawer-backdrop ${open ? "open" : ""}`} onClick={closeDrawer} />
      <aside className={`drawer ${open ? "open" : ""}`} role="dialog" aria-modal="true" aria-labelledby="dr-title" aria-hidden={!open}>
        <div className="drawer-head">
          <div className="dr-meta">
            {r && <><Logo ticker={r.ticker} /><b>{r.ticker}</b><span className="muted">{r.publisher}</span><span className="muted num">· {when(r.published)}</span></>}
          </div>
          <div className="dr-nav">
            {n > 1 && <>
              <button className="icon-btn" aria-label="Previous headline" title="Previous (←)" disabled={idx === 0} onClick={() => setDrawerIdx(idx - 1)}>‹</button>
              <span className="small muted num">{idx + 1} / {n}</span>
              <button className="icon-btn" aria-label="Next headline" title="Next (→)" disabled={idx === n - 1} onClick={() => setDrawerIdx(idx + 1)}>›</button>
            </>}
            <button className="icon-btn" ref={close} aria-label="Close" title="Close (Esc)" onClick={closeDrawer}>✕</button>
          </div>
        </div>
        <div className="drawer-body" ref={body}>
          {r && <div key={key} className="fade-in">
            <h2 className="dr-title" id="dr-title">{r.title}</h2>
            {r.summary && <p className="dr-summary">{r.summary}</p>}
            <div className="dr-verdict">
              <span className={`pill lg ${r.pred}`}>{cap(r.pred)}</span>
              <span className="num">{(r.confidence * 100).toFixed(0)}%</span><span className="muted">confidence · champion model</span>
            </div>
            <div className="sub-head">Why the model thinks so</div>
            {mine?.r ? <AnalysisBody r={mine.r} /> : mine?.error ? <div className="empty error">{mine.error}</div> : <AnalysisSkeleton />}
            <div className="dr-actions">
              {r.url && <a className="btn" href={r.url} target="_blank" rel="noopener">Read the article ↗</a>}
              <button className="btn ghost" onClick={() => { const text = r.text || r.title; closeDrawer(); router.push(`/analyzer?text=${encodeURIComponent(text)}`); }}>Open in Analyzer</button>
            </div>
          </div>}
        </div>
      </aside>
    </>
  );
}
