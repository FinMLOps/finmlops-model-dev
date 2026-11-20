"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Logo } from "@/components/Logo";
import { toggleTheme } from "@/components/Topbar";
import { api } from "@/lib/api";
import { cap, signed, TICKERS, tone } from "@/lib/format";
import type { Article } from "@/lib/types";

const ICON = {
  go: <svg viewBox="0 0 16 16"><path d="M3 8h9M8.5 4.5L12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  action: <svg viewBox="0 0 16 16"><path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>,
  analyze: <svg viewBox="0 0 16 16"><path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>,
};
const GROUPS = ["Tickers", "Headlines", "Go to", "Actions"];
type Item = { group: string; title: string; keys?: string; sub?: string; icon: React.ReactNode; right?: React.ReactNode; run: () => void; score?: number; hit?: number[] };

function fuzzy(query: string, text: string) {
  const q = query.toLowerCase(), t = text.toLowerCase(), at = t.indexOf(q);
  if (at >= 0) return { score: 100 - at + (at === 0 ? 50 : 0), idx: Array.from(q, (_, k) => at + k) };
  const idx: number[] = [];
  for (let i = 0, j = 0; i < t.length && j < q.length; i++) if (t[i] === q[j]) { idx.push(i); j++; }
  return idx.length === q.length ? { score: 40 - (idx[idx.length - 1] - idx[0]), idx } : null;
}

const Marked = ({ text, idx }: { text: string; idx?: number[] }) => {
  const hit = new Set(idx);
  return <>{Array.from(text, (ch, i) => (hit.has(i) ? <mark key={i}>{ch}</mark> : ch))}</>;
};

// ⌘K / Ctrl K: jump to a ticker or page, find a headline, run an action, or analyze what you typed
export function Palette() {
  const app = useApp();
  const { palette, setPalette, ov, selectTicker, setDays, price, setPrice, openDrawer, setTouring } = app;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<{ q: string; rows: Article[] } | null>(null);

  useEffect(() => {
    if (!palette) return;
    setQ(""); setActive(0); setFound(null); // eslint-disable-line react-hooks/set-state-in-effect -- reset on open
    requestAnimationFrame(() => input.current?.focus());
  }, [palette]);

  // headline search runs on the server, a moment after typing stops
  const query = q.trim();
  useEffect(() => {
    if (query.length < 2 || query.length > 80) return;
    const timer = setTimeout(() => {
      api<Article[]>(`/api/headlines?q=${encodeURIComponent(query)}&limit=6`).then(rows => setFound({ q: query, rows }), () => setFound({ q: query, rows: [] }));
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  const items = useMemo(() => {
    const go = (href: string) => () => router.push(href);
    const cmds: Item[] = [
      ...(ov?.tickers ?? TICKERS.map(t => ({ ticker: t, name: "", week: null }))).map(t => ({
        group: "Tickers", title: t.ticker, sub: t.name, keys: `${t.ticker} ${t.name}`, icon: <Logo ticker={t.ticker} />,
        right: t.week ? <span className={`num ${tone(t.week.net)}`}>{signed(t.week.net)}</span> : null, run: () => selectTicker(t.ticker),
      })),
      ...[["/", "Home"], ["/dashboard", "Dashboard"], ["/news", "News feed"], ["/analyzer", "Analyzer"], ["/models", "Models"]].map(([href, name]) => ({
        group: "Go to", title: name, keys: `${name} ${href}`, icon: ICON.go, run: go(href),
      })),
      ...([[7, "1 week"], [14, "2 weeks"], [30, "1 month"], [0, "all time"]] as const).map(([d, label]) => ({
        group: "Actions", title: `Chart range: ${label}`, keys: `chart range ${label}`, icon: ICON.action, run: () => { setDays(d); router.push("/dashboard"); },
      })),
      { group: "Actions", title: price ? "Hide the price overlay" : "Show the price overlay", keys: "price overlay stock close toggle", icon: ICON.action, run: () => { setPrice(!price); router.push("/dashboard"); } },
      { group: "Actions", title: "Take the guided tour", keys: "guided tour help", icon: ICON.action, run: () => { router.push("/dashboard"); setTimeout(() => setTouring(true), 300); } },
      { group: "Actions", title: "Switch light / dark theme", keys: "theme light dark mode", icon: ICON.action, run: () => toggleTheme() },
    ];
    const out: Item[] = [];
    for (const c of cmds) {
      const m = query ? fuzzy(query, c.keys ?? c.title) : { score: 0, idx: [] };
      if (!m) continue;
      out.push({ ...c, score: m.score, hit: query ? fuzzy(query, c.title)?.idx : undefined });
    }
    const rows = found?.q === query && query.length >= 2 ? found.rows : [];
    rows.forEach((h, i) => {
      const at = h.title.toLowerCase().indexOf(query.toLowerCase());
      out.push({ group: "Headlines", title: h.title, score: 30, icon: <Logo ticker={h.ticker} />, hit: at >= 0 ? Array.from(query, (_, k) => at + k) : undefined,
        right: <span className={`pill sm ${h.pred}`}>{cap(h.pred)}</span>, run: () => openDrawer(rows, i) });
    });
    if (query.length >= 3) out.push({
      group: "Actions", title: `Analyze “${query.length > 56 ? query.slice(0, 55) + "…" : query}”`, sub: "with the champion model", score: -1, icon: ICON.analyze,
      run: () => router.push(`/analyzer?text=${encodeURIComponent(query)}`),
    });
    // with a query, the group holding the best match comes first
    const best = (g: string) => Math.max(...out.filter(it => it.group === g).map(it => it.score ?? 0), -Infinity);
    const groups = query ? [...GROUPS].sort((a, b) => best(b) - best(a)) : GROUPS;
    return groups.flatMap(g => out.filter(it => it.group === g).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)));
  }, [query, found, ov, price, router, selectTicker, setDays, setPrice, openDrawer, setTouring]);

  const at = Math.min(active, Math.max(0, items.length - 1));
  const loading = query.length >= 2 && query.length <= 80 && found?.q !== query;
  const run = (i: number) => { const it = items[i]; if (!it) return; setPalette(false); it.run(); };

  useEffect(() => { list.current?.querySelector(".pal-item.active")?.scrollIntoView({ block: "nearest" }); }, [at]);

  if (!palette) return null;
  return (
    <div className="palette open">
      <div className="pal-backdrop" onClick={() => setPalette(false)} />
      <div className="pal-box" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="pal-search">
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          <input ref={input} value={q} placeholder="Search tickers, headlines, actions… or paste a headline" autoComplete="off" spellCheck={false}
            role="combobox" aria-expanded="true" aria-controls="pal-list" aria-activedescendant={items.length ? `pal-opt-${at}` : undefined}
            onChange={e => { setQ(e.target.value); setActive(0); }}
            onKeyDown={e => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (items.length) setActive((at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length); }
              if (e.key === "Enter") { e.preventDefault(); run(at); }
              if (e.key === "Escape") { e.preventDefault(); setPalette(false); }
            }} />
          <kbd>esc</kbd>
        </div>
        <div className="pal-list" id="pal-list" role="listbox" ref={list}>
          {items.map((it, i) => {
            const head = it.group !== items[i - 1]?.group ? <div className="pal-group">{it.group}</div> : null;
            return (
              <div key={`${it.group}-${i}`}>
                {head}
                <div className={`pal-item ${i === at ? "active" : ""}`} id={`pal-opt-${i}`} role="option" aria-selected={i === at}
                  onMouseMove={() => i !== at && setActive(i)} onClick={() => run(i)}>
                  <span className="pal-icon">{it.icon}</span>
                  <span className="pal-main"><Marked text={it.title} idx={it.hit} />{it.sub && <span className="pal-sub">{it.sub}</span>}</span>
                  <span className="pal-right">{it.right}<span className="pal-enter">↵</span></span>
                </div>
              </div>
            );
          })}
          {loading && <><div className="pal-group">Headlines</div><div className="pal-loading"><span className="sk" style={{ width: "72%" }} /></div></>}
          {!items.length && !loading && <div className="pal-empty">No results for “{query}”</div>}
        </div>
        <div className="pal-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> select</span><span><kbd>esc</kbd> close</span>
          <span className="pal-count">{items.length ? `${items.length} result${items.length === 1 ? "" : "s"}` : ""}</span>
        </div>
      </div>
    </div>
  );
}
