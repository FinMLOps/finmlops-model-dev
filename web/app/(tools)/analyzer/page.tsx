"use client";
import { useEffect, useRef, useState } from "react";
import { AnalysisBody, AnalysisSkeleton, type Prediction } from "@/components/Analysis";
import { predict } from "@/components/Drawer";
import { PageHead } from "@/components/PageHead";
import { cap } from "@/lib/format";

const EXAMPLES = [
  "Nvidia beats revenue estimates as data center sales surge",
  "Tesla recalls 200,000 vehicles over steering defect",
  "Microsoft revenue grows 12% but cloud growth misses estimates",
  "Apple to hold annual shareholder meeting in February",
];

export default function Analyzer() {
  const [text, setText] = useState("");
  const [state, setState] = useState<{ busy?: boolean; r?: Prediction; error?: string }>({});
  const token = useRef(0);

  async function analyze(t: string) {
    if (!t.trim()) return;
    const mine = ++token.current;
    setState({ busy: true });
    try {
      const r = await predict(t);
      if (mine === token.current) setState({ r });
    } catch (e) {
      if (mine === token.current) setState({ error: (e as Error).message });
    }
  }

  // "Open in Analyzer" from the detail drawer passes the headline as ?text=
  useEffect(() => {
    document.title = "Analyzer · FinMLOps";
    const t = new URLSearchParams(location.search).get("text");
    if (t) {
      setText(t); // eslint-disable-line react-hooks/set-state-in-effect -- read from the URL once
      analyze(t);
      history.replaceState(null, "", "/analyzer");
    }
  }, []);

  return (
    <>
      <PageHead label="Analyzer" title="Paste a headline. See why." text="The champion model labels it positive, neutral or negative, and shows which words pushed it there." />
      <div className="grid an-grid">
        <div className="panel">
          <div className="panel-head">Headline analyzer <span className="muted">runs the champion model</span></div>
          <form className="an-form" onSubmit={e => { e.preventDefault(); analyze(text); }}>
            <textarea id="an-text" rows={5} maxLength={500} value={text} onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); analyze(text); } }}
              placeholder="Paste a financial headline, e.g. “Nvidia beats revenue estimates as data center sales surge”" />
            <div className="an-row">
              <span className="muted small"><kbd>↵</kbd> analyze · <kbd>Shift</kbd> <kbd>↵</kbd> new line <span className="an-count num">{text.length} / 500</span></span>
              <button className="btn" type="submit" disabled={state.busy}>Analyze</button>
            </div>
          </form>
          <div className="sub-head pad">Try one</div>
          <div className="examples">
            {EXAMPLES.map(t => <button key={t} className="example" onClick={() => { setText(t); analyze(t); }}>{t}</button>)}
          </div>
        </div>
        <div className="panel" id="an-result">
          <div className="panel-head">Result</div>
          {state.busy ? <div className="an-res"><div className="verdict"><span className="sk xl" style={{ width: 110 }} /><span className="sk xl" style={{ width: 56 }} /></div><AnalysisSkeleton /></div>
            : state.error ? <div className="empty error">{state.error}</div>
            : state.r ? (
              <div className="an-res fade-in">
                <div className="verdict"><span className={`pill lg ${state.r.label}`}>{cap(state.r.label)}</span><span className="num">{(state.r.probs[state.r.label] * 100).toFixed(0)}%</span><span className="muted">confidence</span></div>
                <AnalysisBody r={state.r} />
              </div>
            ) : (
              <div className="an-empty">
                <div className="an-empty-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.2 5.6L20 10.8l-5.8 2.2L12 18.6l-2.2-5.6L4 10.8l5.8-2.2z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg></div>
                <b>Ready when you are</b>
                <p>Paste a headline or pick an example. You&apos;ll see the label, how confident the model is, and which words pushed it there.</p>
              </div>
            )}
        </div>
      </div>
    </>
  );
}
