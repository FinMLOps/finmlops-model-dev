"use client";
import { useChartColors, alpha } from "@/lib/chart";
import { cap, LABELS, signed, tone } from "@/lib/format";
import type { Label } from "@/lib/types";

export type Prediction = { label: Label; probs: Record<Label, number>; words: { word: string; impact: number }[] };

export function AnalysisSkeleton() {
  return (
    <>
      <div className="probs">{LABELS.map(l => <div className="prob" key={l}><span className="sk" style={{ width: 56 }} /><span className="sk" style={{ width: "100%", height: 6 }} /><span className="sk" style={{ width: 44 }} /></div>)}</div>
      <p className="words" style={{ marginTop: 16 }}><span className="sk lg" style={{ width: "90%" }} /> <span className="sk lg" style={{ width: "70%" }} /></p>
    </>
  );
}

// probabilities, highlighted words and top drivers for a /api/predict result (Analyzer and the detail drawer)
export function AnalysisBody({ r }: { r: Prediction }) {
  const { C } = useChartColors();
  const pos = C?.positive ?? "#22b07d", neg = C?.negative ?? "#ef4f58";
  const max = Math.max(1e-6, ...r.words.map(w => Math.abs(w.impact)));
  const ranked = [...r.words].sort((a, b) => b.impact - a.impact);
  const list = (items: typeof r.words) => items.length
    ? items.map((w, i) => <div className="driver" key={i}><span>{w.word}</span><span className={`num ${tone(w.impact)}`}>{signed(w.impact * 100)}</span></div>)
    : <div className="driver muted">none</div>;
  return (
    <>
      <div className="probs">
        {LABELS.map(l => (
          <div className="prob" key={l}>
            <span>{cap(l)}</span>
            <div className="bar"><i className={`bg-${l}`} style={{ width: `${(r.probs[l] * 100).toFixed(1)}%` }} /></div>
            <span className="num">{(r.probs[l] * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
      <div className="sub-head">Word influence
        <span className="legend"><i style={{ background: alpha(neg, 0.55) }} />toward negative<i style={{ background: alpha(pos, 0.55) }} />toward positive</span>
      </div>
      <p className="words">
        {r.words.map((w, i) => (
          <span key={i}>
            <span className="w" style={{ background: alpha(w.impact >= 0 ? pos : neg, (Math.abs(w.impact) / max) * 0.55) }} title={`${signed(w.impact * 100)} pts`}>{w.word}</span>{" "}
          </span>
        ))}
      </p>
      <div className="drivers">
        <div><div className="sub-head">Pushes positive</div>{list(ranked.filter(w => w.impact > 0).slice(0, 4))}</div>
        <div><div className="sub-head">Pushes negative</div>{list(ranked.filter(w => w.impact < 0).reverse().slice(0, 4))}</div>
      </div>
      <p className="note">Influence = how many points the positive-minus-negative score drops when that word is removed.</p>
    </>
  );
}
