"use client";
import type { ChartConfiguration } from "chart.js";
import { useEffect, useMemo } from "react";
import { ChartCanvas } from "@/components/ChartCanvas";
import { SkeletonRows } from "@/components/HeadlineTable";
import { PageHead } from "@/components/PageHead";
import { useApi } from "@/lib/api";
import { alpha, useChartColors } from "@/lib/chart";
import { f3, TICKERS, when } from "@/lib/format";
import type { Model } from "@/lib/types";

const MIN_F1 = 0.6;

function Bar({ v, mark }: { v: number | null; mark?: boolean }) {
  return (
    <div className="kpi-bar">
      <i style={{ width: `${Math.min(100, (v ?? 0) * 100)}%` }} />
      {mark && <b style={{ left: `${MIN_F1 * 100}%` }} title="Validation bar: 0.60" />}
    </div>
  );
}

export default function Models() {
  const { data: models, error } = useApi<Model[]>("/api/models");
  const { C, key } = useChartColors();
  const champ = models?.find(m => m.champion);

  useEffect(() => { document.title = "Models · FinMLOps"; }, []);

  const chart = useMemo<ChartConfiguration<"bar"> | null>(() => {
    if (!C || !models?.length) return null;
    const shown = [champ, models.find(m => !m.champion)].filter(m => m != null);
    return {
      type: "bar",
      data: {
        labels: TICKERS,
        datasets: shown.map(m => ({
          label: `v${m.version}${m.champion ? " · champion" : ""}`, data: TICKERS.map(t => m.per_ticker[t] ?? 0),
          backgroundColor: m.champion ? C.accent : alpha(C.muted, 0.5), borderRadius: 3, barPercentage: 0.8, categoryPercentage: 0.7,
        })),
      },
      options: {
        plugins: { legend: { position: "top", align: "end" }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${f3(ctx.parsed.y)}` } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: C.text, maxRotation: 0, autoSkip: false, font: { size: 10.5, weight: 600 } } },
          y: { min: 0, max: 1, ticks: { stepSize: 0.2, callback: v => Number(v).toFixed(1) } },
        },
      },
    };
  }, [C, models, champ]);

  const tiles = [
    ["Champion", champ ? `v${champ.version}` : "—", champ ? champ.run : "none registered", null],
    ["Macro F1", f3(champ?.f1_macro), champ?.f1_macro == null ? "" : champ.f1_macro >= MIN_F1 ? "passes the 0.60 bar" : "below the 0.60 bar", <Bar key="f1" v={champ?.f1_macro ?? null} mark />],
    ["Accuracy", f3(champ?.accuracy), "on the evaluation set", <Bar key="acc" v={champ?.accuracy ?? null} />],
    ["Versions", models ? String(models.length) : "—", "in the registry", null],
  ] as const;

  return (
    <div id="view-models">
      <PageHead label="Models" title="Only better models ship." text="Every registered version, how the champion scores, and the rule a challenger has to pass to replace it." />
      <div className="kpis">
        {tiles.map(([label, v, h, extra]) => (
          <div className="panel kpi" key={label}><span className="label">{label}</span><span className="kpi-v num">{models ? v : <span className="sk xl" style={{ width: 70 }} />}</span><span className="h">{h}</span>{extra}</div>
        ))}
      </div>
      <div className="grid">
        <div className="panel">
          <div className="panel-head">Model registry <span className="muted">finbert-sentiment</span></div>
          <div className="tbl-wrap">
            <table className="tbl">
              {error ? <tbody><tr><td className="empty-row">{error}</td></tr></tbody>
                : !models ? <SkeletonRows n={3} />
                : !models.length ? <tbody><tr><td className="empty-row">No registered models yet. Run: uv run python -m scripts.train baseline</td></tr></tbody>
                : <>
                  <thead><tr><th>Version</th><th>Run</th><th>Registered</th><th className="r">Macro F1</th><th className="r">Accuracy</th><th>Status</th></tr></thead>
                  <tbody>{models.map(m => (
                    <tr key={m.version}>
                      <td className="num">v{m.version}</td><td>{m.run}</td><td className="num t-time">{when(m.created)}</td>
                      <td className="num r">{f3(m.f1_macro)}</td><td className="num r">{f3(m.accuracy)}</td>
                      <td>{m.champion ? <span className="badge champ">Champion</span> : <span className="badge">Candidate</span>}</td>
                    </tr>
                  ))}</tbody>
                </>}
            </table>
          </div>
        </div>
        <div className="side-col">
          <div className="panel">
            <div className="panel-head">Accuracy by ticker</div>
            <div className="chart-box short">
              {chart ? <ChartCanvas config={chart as ChartConfiguration} themeKey={key} /> : <div className="sk-chart">{Array.from({ length: 14 }, (_, i) => <span key={i} className="sk" style={{ height: `${30 + ((i * 37) % 60)}%` }} />)}</div>}
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">Promotion rule</div>
            <ol className="steps rule-steps">
              <li><b>Validate.</b> Macro F1 of at least 0.60 on the gold set, or the run fails.</li>
              <li><b>A real gain.</b> The macro F1 gain stays above zero across a 95% bootstrap interval, so luck can&apos;t promote a model.</li>
              <li><b>No ticker worse off.</b> No ticker more than 0.02 less accurate than under the champion.</li>
              <li><b>Ship or roll back.</b> A winner is copied to cloud storage, then becomes the champion; otherwise the champion stays live.</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
