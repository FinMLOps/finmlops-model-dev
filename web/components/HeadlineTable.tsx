"use client";
import { useApp } from "@/components/AppProvider";
import { Logo } from "@/components/Logo";
import { cap, when } from "@/lib/format";
import type { Article } from "@/lib/types";

export function SkeletonRows({ n = 6 }: { n?: number }) {
  const widths = ["72%", "58%", "84%", "64%", "78%", "50%"];
  return (
    <tbody>
      {Array.from({ length: n }, (_, i) => (
        <tr key={i}>
          <td className="t-time"><span className="sk" style={{ width: 56 }} /></td>
          <td className="t-tkr"><span className="sk lg" style={{ width: 62 }} /></td>
          <td className="t-title"><span className="sk" style={{ width: widths[i % 6] }} /><span className="pub"><span className="sk" style={{ width: 90 }} /></span></td>
          <td className="t-sent"><span className="sk lg" style={{ width: 76 }} /></td>
          <td className="t-conf"><span className="sk" style={{ width: 92 }} /></td>
        </tr>
      ))}
    </tbody>
  );
}

// one entry per article: an article about two companies has a row, and a label, for each of them
export function groupRows(rows: Article[]) {
  const byId = new Map<string, Article[]>();
  for (const r of rows) {
    const g = byId.get(r.id);
    if (g) g.push(r);
    else byId.set(r.id, [r]);
  }
  return [...byId.values()];
}

// one row per article with each company's label and confidence; a row opens the detail drawer (click, or Enter when focused)
export function HeadlineTable({ rows, error, id }: { rows?: Article[]; error?: string; id?: string }) {
  const { openDrawer, selectTicker } = useApp();
  return (
    <div className="tbl-wrap">
      <table className="tbl" id={id}>
        {error ? <tbody><tr><td className="empty-row">{error}</td></tr></tbody>
          : !rows ? <SkeletonRows />
          : !rows.length ? <tbody><tr><td className="empty-row">No headlines match.</td></tr></tbody>
          : <>
            <thead><tr><th className="t-time">Time</th><th className="t-tkr">Ticker</th><th>Headline</th><th>Sentiment</th><th className="t-conf">Confidence</th></tr></thead>
            <tbody>
              {groupRows(rows).map((g, i) => {
                const r = g[0], at = rows.indexOf(r);
                return (
                  <tr key={r.id} className="row-in" style={{ "--i": Math.min(i, 14) } as React.CSSProperties} tabIndex={0}
                    data-idx={at} onClick={() => openDrawer(rows, at)} onKeyDown={e => e.key === "Enter" && openDrawer(rows, at)}>
                    <td className="t-time num">{when(r.published)}</td>
                    <td className="t-tkr"><span className="stack">{g.map(a => (
                      <span key={a.ticker} className="tkr" onClick={e => { e.stopPropagation(); selectTicker(a.ticker); }}><Logo ticker={a.ticker} />{a.ticker}</span>
                    ))}</span></td>
                    <td className="t-title">
                      <span className="hl">{r.title}</span>
                      {r.url && <a className="ext" href={r.url} target="_blank" rel="noopener" aria-label="Open article" onClick={e => e.stopPropagation()}>↗</a>}
                      <span className="pub">{r.publisher}</span>
                    </td>
                    <td className="t-sent"><span className="stack">{g.map(a => <span key={a.ticker} className={`pill ${a.pred}`}><b className="pill-tkr">{a.ticker}</b>{cap(a.pred)}</span>)}</span></td>
                    <td className="t-conf"><span className="stack">{g.map(a => (
                      <span key={a.ticker}><span className="conf"><i style={{ width: `${(a.confidence * 100).toFixed(0)}%` }} /></span><span className="num">{(a.confidence * 100).toFixed(0)}%</span></span>
                    ))}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </>}
      </table>
    </div>
  );
}
