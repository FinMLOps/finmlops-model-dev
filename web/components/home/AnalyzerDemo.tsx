"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnalysisBody, AnalysisSkeleton, type Prediction } from "@/components/Analysis";
import { Win } from "@/components/home/Feature";
import { usePlayback } from "@/lib/motion";

// the headlines it types in and the result it shows; impact is one number per word of the headline.
// Illustrative until the real model's output is swapped in (the link under the demo runs the real one).
const EXAMPLES = [
  { text: "Nvidia Rehires Huang in Stunning Reversal After Trump Push", label: "positive", probs: [0.84, 0.112, 0.048], impact: [0.02, 0.31, 0.03, 0, 0.09, 0.14, 0, -0.04, 0.05] },
  { text: "Jensen Huang Has Been Ousted as Nvidia CEO", label: "negative", probs: [0.001, 0.003, 0.996], impact: [0.01, 0, 0, -0.02, -0.58, 0, 0.01, -0.06] },
].map(e => ({
  text: e.text,
  r: {
    label: e.label, probs: { positive: e.probs[0], neutral: e.probs[1], negative: e.probs[2] },
    words: e.text.split(" ").map((word, i) => ({ word, impact: e.impact[i] })),
  } as Prediction,
}));

const KEY = 38, PAUSE = 450, PRESS = 350, THINK = 800, HOLD = 4500; // ms: per typed letter, before and during the click, model, result

type State = { ex: number; typed: number; phase: "type" | "press" | "think" | "result" };

export function AnalyzerDemo() {
  const box = useRef<HTMLDivElement>(null);
  const { playing, reduced } = usePlayback(box);
  const [s, set] = useState<State>({ ex: 0, typed: 0, phase: "type" });
  const v: State = reduced ? { ex: 0, typed: EXAMPLES[0].text.length, phase: "result" } : s; // reduced motion: the result, still
  const ex = EXAMPLES[v.ex];

  // type the headline, press Analyze, think, show the result, then the next headline
  useEffect(() => {
    if (!playing) return;
    const len = EXAMPLES[s.ex].text.length;
    const [ms, next]: [number, State] =
      s.phase === "type" ? (s.typed < len ? [KEY, { ...s, typed: s.typed + 1 }] : [PAUSE, { ...s, phase: "press" }])
      : s.phase === "press" ? [PRESS, { ...s, phase: "think" }]
      : s.phase === "think" ? [THINK, { ...s, phase: "result" }]
      : [HOLD, { ex: (s.ex + 1) % EXAMPLES.length, typed: 0, phase: "type" }];
    const id = setTimeout(() => set(next), ms);
    return () => clearTimeout(id);
  }, [playing, s]);

  return (
    <Win title="analyzer">
      <div className="am" ref={box}>
        <div aria-hidden="true">
          <div className="am-input">
            {v.typed ? ex.text.slice(0, v.typed) : <span className="am-ph">Paste a financial headline…</span>}
            {v.phase === "type" && <span className="am-caret" />}
          </div>
          <div className="am-actions">
            <span>Enter ↵ to analyze</span>
            <span className={`btn am-btn${v.phase === "press" ? " down" : ""}`}>Analyze</span>
          </div>
          <div className="am-out">
            {v.phase === "think" ? <AnalysisSkeleton />
              : v.phase === "result" ? <div className="am-result" key={v.ex}><AnalysisBody r={ex.r} /></div>
              : <p className="am-empty">The result shows up here</p>}
          </div>
        </div>
        <div className="am-foot">
          <span>Illustrative output</span>
          <Link href={`/analyzer?text=${encodeURIComponent(ex.text)}`}>Run it on the real model →</Link>
        </div>
      </div>
    </Win>
  );
}
