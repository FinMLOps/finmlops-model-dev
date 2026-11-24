"use client";
import Link from "next/link";
import { useRef } from "react";
import { Logo } from "@/components/Logo";
import { useOverview } from "@/lib/api";
import { arrow, day, signed, tone } from "@/lib/format";
import { Count, usePlayback } from "@/lib/motion";

// this week's net sentiment for every stock, most positive first, under a sentence written from the same data
export function Mood() {
  const { data, error } = useOverview();
  const box = useRef<HTMLElement>(null);
  const { seen, reduced } = usePlayback(box);
  const go = seen || reduced; // the bars grow the first time it scrolls into view
  const rows = (data?.tickers ?? []).map(t => ({ ...t, swing: t.week.net - t.prev.net })).sort((a, b) => b.week.net - a.week.net);
  // the zero line sits where the range puts it (high when most stocks are negative), so the bars use the full height
  const hiPos = Math.max(0, ...rows.map(r => r.week.net)), span = Math.max(1, hiPos + Math.max(0, ...rows.map(r => -r.week.net)));
  // the story: the stock the news talked about most, and which way everyone else went
  const top = rows.reduce<(typeof rows)[number] | undefined>((a, r) => (!a || r.week.articles > a.week.articles ? r : a), undefined);
  const rose = rows.filter(r => r !== top && r.swing > 0).length;

  return (
    <section className="panel mood" ref={box}>
      <div className="mood-head">
        <span className="label">The mood this week{data && ` · week ending ${day(data.as_of.slice(0, 10))}`}</span>
        <Link className="feature-link" href="/dashboard">Open the dashboard <span aria-hidden="true">→</span></Link>
      </div>
      {error ? <p className="mood-story muted">Couldn&apos;t load this week&apos;s sentiment.</p> : !top ? (
        <div className="mood-story"><span className="sk lg" style={{ width: "80%" }} /><span className="sk" style={{ width: "100%", height: 150, marginTop: 18 }} /></div>
      ) : (
        <>
          <p className="mood-story">
            {top.name} drew the most headlines this week, <b>{top.week.articles.toLocaleString("en-US")}</b> of them, and its sentiment{" "}
            {Math.abs(top.swing) < 0.05 ? "held steady at " : `${top.swing < 0 ? "fell" : "rose"} ${Math.abs(top.swing).toFixed(1)} points to `}
            <b className={tone(top.week.net)}>{signed(top.week.net)}</b>. Sentiment rose for {rose} of the other {rows.length - 1}.
          </p>
          <div className={`mood-chart${go ? " go" : ""}`} style={{ "--z": hiPos / span } as React.CSSProperties}>
            {rows.map((r, i) => (
              <Link key={r.ticker} className="mood-col" href={`/dashboard?ticker=${r.ticker}`}
                title={`${r.ticker}: ${signed(r.week.net)} over the last 7 days, ${signed(r.swing)} vs the 7 days before (${r.week.articles} headlines)`}>
                <span className="mood-track">
                  <i className={`mood-bar ${r.week.net >= 0 ? "pos" : "neg"}`} style={{ "--h": `${(Math.abs(r.week.net) / span) * 100}%`, "--i": i } as React.CSSProperties} />
                </span>
                <Logo ticker={r.ticker} />
                <b>{r.ticker}</b>
                <span className={`num ${tone(r.week.net)}`}><Count value={go ? r.week.net : 0} from={0} duration={900} fmt={v => signed(v)} /></span>
                <small className={`num ${tone(r.swing)}`}>{arrow(r.swing)} {Math.abs(r.swing).toFixed(1)}</small>
              </Link>
            ))}
          </div>
          <p className="mood-note">Net sentiment = % positive − % negative headlines over the last 7 days. Arrows compare it with the 7 days before.</p>
        </>
      )}
    </section>
  );
}
