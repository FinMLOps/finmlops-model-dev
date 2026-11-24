"use client";
import Link from "next/link";
import { useApp } from "@/components/AppProvider";
import { Logo } from "@/components/Logo";
import { useApi } from "@/lib/api";
import { cap, when } from "@/lib/format";
import type { Article } from "@/lib/types";

const CARDS = 4;

// the newest real headlines with the champion's labels
export function JustScored() {
  const { openDrawer } = useApp();
  const { data, error } = useApi<Article[]>("/api/headlines?limit=40");
  // one card per article: an article about two companies has a row, and a label, for each
  const groups: Article[][] = [];
  for (const a of data ?? []) {
    const g = groups.find(g => g[0].id === a.id);
    if (g) g.push(a);
    else if (groups.length < CARDS) groups.push([a]);
  }
  const rows = groups.flat();

  return (
    <section className="scored">
      <div className="section-head">
        <div><span className="label">Just scored</span><h2>The latest headlines, labeled by the champion.</h2></div>
        <Link className="feature-link" href="/news">See all headlines <span aria-hidden="true">→</span></Link>
      </div>
      {error ? <p className="panel empty">Couldn&apos;t load the latest headlines.</p> : (
        <div className="scored-grid">
          {!data ? Array.from({ length: CARDS }, (_, k) => (
            <div key={k} className="panel sc"><span className="sk" style={{ width: 90 }} /><span className="sk lg" style={{ width: "100%" }} /><span className="sk lg" style={{ width: "70%" }} /></div>
          )) : groups.map((g, k) => (
            <button key={g[0].id} className="panel sc" style={{ "--i": k } as React.CSSProperties} onClick={() => openDrawer(rows, rows.indexOf(g[0]))}>
              <span className="sc-meta">{g[0].publisher} · {when(g[0].published)}</span>
              <b className="sc-title">{g[0].title}</b>
              <span className="sc-labels">
                {g.map(a => (
                  <span key={a.ticker} className="sc-tag">
                    <Logo ticker={a.ticker} />{a.ticker}
                    <span className={`pill sm ${a.pred}`}>{cap(a.pred)} {Math.round(a.confidence * 100)}%</span>
                  </span>
                ))}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
