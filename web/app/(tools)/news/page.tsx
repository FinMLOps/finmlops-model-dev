"use client";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { groupRows, HeadlineTable } from "@/components/HeadlineTable";
import { PageHead } from "@/components/PageHead";
import { api } from "@/lib/api";
import { TICKERS } from "@/lib/format";
import type { Article } from "@/lib/types";

const LABEL_FILTERS = [["", "All"], ["positive", "Positive"], ["neutral", "Neutral"], ["negative", "Negative"]];
const PAGE = 50; // articles loaded at first, and by each "Show more"

const articles = (rows: Article[]) => new Set(rows.map(r => r.id)).size;

export default function News() {
  const { toast } = useApp();
  const [ticker, setTicker] = useState("");
  const [label, setLabel] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState(""); // the search actually sent, a moment after typing stops
  const [result, setResult] = useState<{ rows?: Article[]; error?: string; more?: boolean }>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const search = useRef(0); // bumped on every new search, so a slow "Show more" can't append to the wrong results

  useEffect(() => { document.title = "News · FinMLOps"; }, []);

  // the server filters and searches every article, and sends one page of them at a time
  const url = (offset: number) =>
    `/api/headlines?ticker=${ticker}&label=${label}&q=${encodeURIComponent(query)}&articles=${PAGE}&offset=${offset}`;

  useEffect(() => {
    let live = true;
    search.current++;
    setResult({}); // eslint-disable-line react-hooks/set-state-in-effect -- show the skeleton while a new search runs
    api<Article[]>(url(0)).then(
      rows => live && setResult({ rows, more: articles(rows) === PAGE }),
      e => live && setResult({ error: e.message }),
    );
    return () => { live = false; };
  }, [ticker, label, query]); // eslint-disable-line react-hooks/exhaustive-deps -- url() is built from these

  async function showMore() {
    if (!result.rows || loadingMore) return;
    const mine = search.current;
    setLoadingMore(true);
    try {
      const next = await api<Article[]>(url(articles(result.rows)));
      if (mine === search.current) setResult(r => ({ rows: [...(r.rows ?? []), ...next], more: articles(next) === PAGE }));
    } catch (e) {
      toast(`Couldn't load more headlines: ${(e as Error).message}`);
    } finally {
      setLoadingMore(false);
    }
  }

  const shown = result.rows && groupRows(result.rows).length;

  return (
    <>
      <PageHead label="News" title="Every headline, labeled." text="The champion's label for every article, newest first. An article about two companies gets a label for each." />
      <div className="panel" id="view-headlines">
        <div className="panel-head wrap">
          News feed <span className="muted">{shown != null ? `${shown} article${shown === 1 ? "" : "s"}${result.more ? ", newest first" : ""}` : ""}</span>
          <div className="filters">
            <div className="seg">
              {["", ...TICKERS].map(t => <button key={t} className={ticker === t ? "active" : ""} onClick={() => setTicker(t)}>{t || "All"}</button>)}
            </div>
            <div className="seg">
              {LABEL_FILTERS.map(([v, name]) => <button key={v} className={label === v ? "active" : ""} onClick={() => setLabel(v)}>{name}</button>)}
            </div>
            <input className="search" placeholder="Filter headlines…" value={q} onChange={e => {
              setQ(e.target.value);
              clearTimeout(timer.current);
              const v = e.target.value.trim();
              timer.current = setTimeout(() => setQuery(v), 250);
            }} />
          </div>
        </div>
        <HeadlineTable rows={result.rows} error={result.error} />
        {result.more && (
          <div className="more">
            <button className="btn ghost" onClick={showMore} disabled={loadingMore}>{loadingMore ? "Loading…" : "Show more"}</button>
          </div>
        )}
      </div>
    </>
  );
}
