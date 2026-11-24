"use client";
import { useEffect, useRef, useState } from "react";
import { groupRows, HeadlineTable } from "@/components/HeadlineTable";
import { PageHead } from "@/components/PageHead";
import { api } from "@/lib/api";
import { TICKERS } from "@/lib/format";
import type { Article } from "@/lib/types";

const LABEL_FILTERS = [["", "All"], ["positive", "Positive"], ["neutral", "Neutral"], ["negative", "Negative"]];
const PAGE = 50; // articles shown at first, and added by each "Show more"

export default function News() {
  const [ticker, setTicker] = useState("");
  const [label, setLabel] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState(""); // the search actually sent, a moment after typing stops
  const [result, setResult] = useState<{ rows?: Article[]; error?: string }>({});
  const [n, setN] = useState(PAGE);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => { document.title = "News · FinMLOps"; }, []);

  // the search runs on the server, over every article (not just the 300 shown)
  useEffect(() => {
    let live = true;
    setResult({}); // eslint-disable-line react-hooks/set-state-in-effect -- show the skeleton while a new search runs
    api<Article[]>(`/api/headlines?ticker=${ticker}&label=${label}&q=${encodeURIComponent(query)}&limit=300`).then(
      rows => live && setResult({ rows }),
      e => live && setResult({ error: e.message }),
    );
    return () => { live = false; };
  }, [ticker, label, query]);

  const groups = result.rows && groupRows(result.rows);

  return (
    <>
      <PageHead label="News" title="Every headline, labeled." text="The champion's label for every article, newest first. An article about two companies gets a label for each." />
      <div className="panel" id="view-headlines">
        <div className="panel-head wrap">
          News feed <span className="muted">{groups ? `${Math.min(n, groups.length)} of the latest ${groups.length} articles` : ""}</span>
          <div className="filters">
            <div className="seg">
              {["", ...TICKERS].map(t => <button key={t} className={ticker === t ? "active" : ""} onClick={() => { setTicker(t); setN(PAGE); }}>{t || "All"}</button>)}
            </div>
            <div className="seg">
              {LABEL_FILTERS.map(([v, name]) => <button key={v} className={label === v ? "active" : ""} onClick={() => { setLabel(v); setN(PAGE); }}>{name}</button>)}
            </div>
            <input className="search" placeholder="Filter headlines…" value={q} onChange={e => {
              setQ(e.target.value);
              clearTimeout(timer.current);
              const v = e.target.value.trim();
              timer.current = setTimeout(() => { setQuery(v); setN(PAGE); }, 250);
            }} />
          </div>
        </div>
        <HeadlineTable rows={groups?.slice(0, n).flat()} error={result.error} />
        {groups && groups.length > n && <div className="more"><button className="btn ghost" onClick={() => setN(n + PAGE)}>Show more</button></div>}
      </div>
    </>
  );
}
