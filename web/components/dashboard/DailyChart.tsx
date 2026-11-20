"use client";
import type { ChartConfiguration } from "chart.js";
import { useMemo } from "react";
import { useApp } from "@/components/AppProvider";
import { ChartCanvas } from "@/components/ChartCanvas";
import { alpha, crosshair, markers, useChartColors } from "@/lib/chart";
import { cap, day, LABELS, signed, tone } from "@/lib/format";
import { Count } from "@/lib/motion";

const trunc = (s: string, n = 64) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const RANGES = [[7, "1W"], [14, "2W"], [30, "1M"], [0, "All"]] as const;
const PRICE_AXIS = 58;

export function DailyChart() {
  const { ov, ticker, days, setDays, price, setPrice, openDrawer, toast } = useApp();
  const { C, key } = useChartColors();
  const t = ov?.tickers.find(x => x.ticker === ticker);

  const rows = useMemo(() => {
    if (!t || !ov) return [];
    if (!days) return t.daily;
    const cut = new Date(new Date(ov.as_of).getTime() - days * 864e5).toISOString().slice(0, 10);
    return t.daily.filter(r => r.date > cut);
  }, [t, ov, days]);

  const known = rows.map(r => r.close).filter((v): v is number => v != null);
  const hasPrice = known.length > 1, showPrice = hasPrice && price;

  const charts = useMemo(() => {
    if (!C || !rows.length) return null;
    const closes = rows.map(r => r.close ?? null);
    const hasPrice = closes.filter(v => v != null).length > 1, showPrice = hasPrice && price;
    const labels = rows.map(r => day(r.date));
    const nets = rows.map(r => r.net);
    const hiIdx = nets.indexOf(Math.max(...nets)), loIdx = nets.indexOf(Math.min(...nets));
    const dayHeadlines = (i: number) => {
      const r = rows[i], list = [r.top_positive, r.top_negative].filter(a => a != null);
      return { list, start: i === loIdx && r.top_negative ? list.indexOf(r.top_negative) : 0 };
    };
    const yAxis = (extra: object) => ({ position: "right" as const, afterFit: (s: { width: number }) => { s.width = 46; }, ...extra });
    const tooltip = { position: "nearest" as const, caretPadding: 8 };
    const datasets: ChartConfiguration<"line">["data"]["datasets"] = [{
      label: "Net sentiment", data: nets, yAxisID: "y", order: 1, borderColor: C.accent, borderWidth: 2, tension: 0.15,
      pointRadius: rows.map((_, i) => (i === hiIdx || i === loIdx ? 5 : 0)),
      pointBackgroundColor: rows.map((_, i) => (i === hiIdx ? C.positive : i === loIdx ? C.negative : C.accent)),
      pointBorderColor: C.panel, pointBorderWidth: 2,
      pointHoverRadius: 5, pointHoverBackgroundColor: C.accent, pointHoverBorderColor: "#fff", pointHoverBorderWidth: 2,
      fill: { target: "origin", above: alpha(C.positive, 0.1), below: alpha(C.negative, 0.12) },
    }];
    // always present when there are prices (hidden when toggled off), so toggling animates instead of redrawing
    if (hasPrice) datasets.push({
      label: "Close", data: closes, yAxisID: "price", order: 0, spanGaps: true, hidden: !showPrice,
      borderColor: C.price, borderWidth: 1.5, tension: 0.2, fill: false,
      pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: C.price, pointHoverBorderColor: "#fff", pointHoverBorderWidth: 2,
    });
    const line: ChartConfiguration<"line"> = {
      type: "line",
      data: { labels, datasets },
      plugins: [crosshair, markers],
      options: {
        layout: { padding: { top: 16 } },
        interaction: { mode: "index", intersect: false },
        onClick: (_e, els) => {
          if (!els.length) return;
          const { list, start } = dayHeadlines(els[0].index);
          if (!list.length) return toast(`No headlines for ${labels[els[0].index]}.`);
          openDrawer(list, start);
        },
        onHover: (e, els) => { (e.native?.target as HTMLElement).style.cursor = els.length ? "pointer" : "default"; },
        plugins: {
          legend: { display: false },
          // @ts-expect-error -- options for our own markers plugin
          markers: { points: [{ i: hiIdx, text: "High", color: C.positive, above: true }, ...(loIdx !== hiIdx ? [{ i: loIdx, text: "Low", color: C.negative, above: false }] : [])] },
          tooltip: {
            ...tooltip,
            filter: ctx => ctx.parsed.y != null,
            callbacks: {
              label: ctx => (ctx.dataset.yAxisID === "price" ? ` Close: $${ctx.parsed.y!.toFixed(2)}` : ` Net sentiment: ${signed(ctx.parsed.y!)}`),
              afterBody: items => {
                const r = rows[items[0].dataIndex], out: string[] = [];
                if (r.top_positive || r.top_negative) out.push("");
                if (r.top_positive) out.push(`▲ ${trunc(r.top_positive.title)}`);
                if (r.top_negative) out.push(`▼ ${trunc(r.top_negative.title)}`);
                return out;
              },
              footer: items => (dayHeadlines(items[0].dataIndex).list.length ? "Click to read the top headlines" : ""),
            },
            footerColor: C.faint, footerFont: { weight: 500, size: 10.5 }, footerMarginTop: 8,
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { display: false }, border: { display: false } },
          y: yAxis({
            grace: "8%", border: { display: false },
            grid: { color: (ctx: { tick: { value: number } }) => (ctx.tick.value === 0 ? C.border2 : C.grid) },
            ticks: { color: showPrice ? C.accent : C.muted, maxTicksLimit: 6, callback: (v: number | string) => (Number(v) > 0 ? "+" : "") + v },
          }),
          price: {
            display: showPrice, position: "left", grace: "5%", afterFit: s => { s.width = PRICE_AXIS; },
            border: { display: false }, grid: { display: false },
            ticks: { color: C.price, maxTicksLimit: 6, callback: v => `$${Math.round(Number(v))}` },
          },
        },
      },
    };
    const bars: ChartConfiguration<"bar"> = {
      type: "bar",
      data: {
        labels,
        datasets: LABELS.map(l => ({
          label: cap(l), data: rows.map(r => r[l]), stack: "articles",
          backgroundColor: alpha(C[l], 0.55), hoverBackgroundColor: C[l], barPercentage: 0.8, categoryPercentage: 0.9,
        })),
      },
      plugins: [crosshair],
      options: {
        layout: { padding: { left: showPrice ? PRICE_AXIS : 0 } },
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: false }, tooltip },
        scales: {
          x: { stacked: true, grid: { display: false }, border: { color: C.grid }, ticks: { maxRotation: 0, autoSkipPadding: 18 } },
          y: yAxis({ stacked: true, beginAtZero: true, border: { display: false }, grid: { color: C.grid }, ticks: { maxTicksLimit: 3, color: C.faint } }),
        },
      },
    };
    return { line, bars };
  }, [C, rows, price, openDrawer, toast]);

  const nets = rows.map(r => r.net);
  const avg = nets.length ? nets.reduce((a, b) => a + b, 0) / nets.length : 0;
  const total = rows.reduce((a, r) => a + r.articles, 0);
  const priceChange = hasPrice ? (known[known.length - 1] / known[0] - 1) * 100 : 0;

  return (
    <div className="panel chart-panel">
      <div className="panel-head">
        Daily sentiment
        <div className="head-right">
          {hasPrice && <button className={`toggle ${price ? "on" : ""}`} title="Show the daily closing price" onClick={() => setPrice(!price)}><i />Price</button>}
          <div className="seg">
            {RANGES.map(([d, label]) => <button key={d} className={days === d ? "active" : ""} onClick={() => setDays(d)}>{label}</button>)}
          </div>
        </div>
      </div>
      <div className="chart-stats">
        {rows.length ? <>
          <div className="cs"><span className="label">Average net</span><span className={`v num ${tone(avg)}`}><Count value={avg} fmt={v => signed(v)} /></span><span className="h">{rows.length} days</span></div>
          <div className="cs"><span className="label">Articles</span><span className="v num"><Count value={total} fmt={v => Math.round(v).toLocaleString("en-US")} /></span><span className="h">{Math.round(total / rows.length)} / day</span></div>
          {hasPrice && <div className="cs"><span className="label">Close</span><span className="v num"><Count value={known[known.length - 1]} fmt={v => `$${v.toFixed(2)}`} /></span><span className="h"><span className={tone(priceChange)}>{signed(priceChange, 2)}%</span> in range</span></div>}
          <div className="chart-legend">
            <span><i className="line" />Net sentiment</span>
            {showPrice && <span><i className="line price" />Close price</span>}
            {LABELS.map(l => <span key={l}><i className={`bg-${l}`} />{cap(l)}</span>)}
          </div>
        </> : Array.from({ length: 4 }, (_, i) => <div className="cs" key={i}><span className="sk" style={{ width: 70 }} /><span className="sk lg" style={{ width: 52 }} /></div>)}
      </div>
      <div className="chart-box main">
        {charts ? <ChartCanvas config={charts.line as ChartConfiguration} themeKey={key} /> : <div className="sk-chart"><span className="sk block" /></div>}
      </div>
      <div className="chart-box vol">
        {charts ? <ChartCanvas config={charts.bars as ChartConfiguration} themeKey={key} />
          : <div className="sk-chart">{Array.from({ length: 30 }, (_, i) => <span key={i} className="sk" style={{ height: `${30 + ((i * 37) % 60)}%` }} />)}</div>}
      </div>
    </div>
  );
}
