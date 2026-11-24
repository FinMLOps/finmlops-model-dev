"use client";
/* eslint-disable @next/next/no-img-element -- tiny SVG logos; next/image adds nothing here */
import { useEffect, useRef, useState } from "react";
import { Feature, Win } from "@/components/home/Feature";
import { usePlayback } from "@/lib/motion";

/* ============ the pipeline: swap tools, labels and log lines here ============ */

const STEPS = [
  <><b>Collect.</b> Airflow pulls news from the free Finnhub and Marketaux APIs, checks every batch against a schema, and versions each snapshot with DVC.</>,
  <><b>Read.</b> A language model, FinBERT for now, labels each headline for its company, with a confidence score and the words that drove it.</>,
  <><b>Prove.</b> A new model replaces the champion only if it&apos;s significantly better on held-out news and no stock gets worse.</>,
  <><b>Show.</b> This dashboard: daily sentiment against the price, a two-week market pulse, and the reasoning behind every label.</>,
];

// in the order the data flows; step is the STEPS entry it belongs to. Icons are the logos in public/stack/<id>.svg,
// except "web", "finbert" and "app", which are drawn below.
const NODES = [
  { name: "The web", sub: "Finnhub · Marketaux", icons: ["web"], step: 0, log: "fetching the latest headlines from Finnhub and Marketaux" },
  { name: "Airflow", sub: "Runs it daily", icons: ["airflow"], step: 0, log: "airflow: the daily run picks up the new batch" },
  { name: "Preprocess", sub: "Python · TFDV", icons: ["python", "tensorflow"], step: 0, log: "python cleans the text, TFDV checks it against the schema ✓" },
  { name: "DVC", sub: "Versions data", icons: ["dvc"], step: 0, log: "dvc: snapshot versioned and stored on Google Cloud" },
  { name: "FinBERT", sub: "Labels headlines", icons: ["finbert"], step: 1, log: "finbert: \"Jensen Huang Has Been Ousted as Nvidia CEO\" → negative" },
  { name: "MLflow", sub: "Tracks · promotes", icons: ["mlflow"], step: 2, log: "mlflow: run logged, the challenger faces the champion rule" },
  { name: "Google Cloud", sub: "Storage · Cloud Run", icons: ["googlecloud"], step: 3, log: "google cloud: the champion model is pushed to Cloud Storage" },
  { name: "Dashboard", sub: "You're here", icons: ["app"], step: 3, log: "dashboard: sentiment and price updated for all 7 stocks" },
];

const START = 500, WORK = 1200, TRAVEL = 700, HOLD = 2800; // ms: before a run, at each tool, between tools, after a run

/* ============ playback ============ */

export function HowItWorks() {
  const box = useRef<HTMLDivElement>(null);
  const { playing, reduced } = usePlayback(box);
  const last = 2 * (NODES.length - 1);
  const [t, setT] = useState(-1); // even: tool t/2 is working; odd: the packet is on its way to the next tool; -1: between runs
  const now = reduced && t < 0 ? last + 1 : t; // reduced motion: the finished run until a step is picked
  const at = Math.min(NODES.length - 1, Math.floor(Math.max(now, 0) / 2));
  const step = now >= 0 && now <= last ? NODES[at].step : -1;

  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(() => setT(t >= last ? -1 : t + 1), t < 0 ? START : t === last ? HOLD : t % 2 ? TRAVEL : WORK);
    return () => clearTimeout(id);
  }, [playing, t, last]);

  return (
    <Feature id="how" label="How it works" title="From the web to this page, every day." href="/models" cta="See the models" side={
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={i} className={i === step ? "on" : ""} aria-current={i === step ? "step" : undefined}>
            <button className="step-btn" onClick={() => setT(2 * NODES.findIndex(n => n.step === i))}>{s}</button>
          </li>
        ))}
      </ol>
    }>
      <Win title="pipeline · daily run">
        <div className="pipe" aria-hidden="true" ref={box}>
          <div className="pipe-grid" style={{ "--travel": `${TRAVEL}ms` } as React.CSSProperties}>
            {NODES.map((n, k) => {
              // a snake: the first row runs left to right (labels above, so the turn down crosses no text), then back
              const row2 = k >= NODES.length / 2;
              const tool = 2 * k < now ? "done" : 2 * k === now ? "on" : "";
              const wire = 2 * k + 1 < now ? "done" : 2 * k + 1 === now ? "on" : "";
              return (
                <div key={n.name} className={`pn${row2 ? "" : " top"} ${tool}`} style={{ gridRow: row2 ? 2 : 1, gridColumn: row2 ? NODES.length - k : k + 1 }}>
                  {k < NODES.length - 1 && <span className={`wire ${k === NODES.length / 2 - 1 ? "d" : row2 ? "l" : "r"} ${wire}`}><i /></span>}
                  <span className={`pn-ico${n.icons.length > 1 ? " duo" : ""}`}>{n.icons.map(id => <Icon key={id} id={id} />)}</span>
                  <b>{n.name}</b>
                  <small>{n.sub}</small>
                </div>
              );
            })}
          </div>
          {/* every line is rendered in the same spot and only the current one shows, so the box is always as tall
              as the longest line and never jumps */}
          <p className="pipe-log">{NODES.map((n, k) => <span key={k} className={k === at ? "on" : ""}><i>›</i>{n.log}</span>)}</p>
        </div>
      </Win>
    </Feature>
  );
}

function Icon({ id }: { id: string }) {
  if (id === "web") return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </svg>
  );
  // FinBERT: an F with a small Hugging Face badge, where the model comes from
  if (id === "finbert") return <><span className="pn-f">F</span><span className="pn-hf"><img src="/stack/huggingface.svg" alt="" /></span></>;
  if (id === "app") return <img className="pn-app" src="/img/android-chrome-192x192.png" alt="" />;
  return <img src={`/stack/${id}.svg`} alt="" />;
}
