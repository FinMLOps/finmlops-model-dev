"""Slice analysis (bias detection): does the model work equally well for every ticker, source, publisher and headline
length? Uses Fairlearn's MetricFrame, writes a markdown report and charts, and flags slices that fall behind.

Called by pipeline.py for every challenger; the results are logged to MLflow and a warning goes into the email.
"""

from functools import partial

import matplotlib

matplotlib.use("Agg")  # no screen in Docker / CI; charts are only saved to files
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd
from fairlearn.metrics import MetricFrame, count
from sklearn.metrics import accuracy_score, f1_score

from scripts.config import LABELS, MAX_SLICE_GAP, MIN_SLICE_ROWS, OUT_DIR, TOP_PUBLISHERS

SLICE_DIR = OUT_DIR / "slices"
METRICS = {
    "accuracy": accuracy_score,
    "f1_macro": partial(f1_score, labels=LABELS, average="macro", zero_division=0),
    "rows": count,
}
# what to do about a slice that falls behind (the report suggests these; the class-weighted loss already re-weights)
MITIGATION = ("Mitigation options: hand-label more rows for the weak slice and add them to training, oversample it "
              "(re-sampling), or give it more weight in the loss (re-weighting, as the class weights already do for "
              "the rare labels).")


def features(df):
    """the slices we check; publishers outside the top few are pooled into "other" so each slice has enough rows"""
    top = df["publisher"].value_counts().index[:TOP_PUBLISHERS]
    length = df["text"].fillna("").str.len()
    out = {
        "ticker": df["ticker"],
        "source": df["source"],
        "publisher": df["publisher"].where(df["publisher"].isin(top), "other"),
        "length": pd.cut(length, [-1, 120, 300, float("inf")], labels=["short", "medium", "long"]).astype(str),
    }
    if "mixed_signal" in df and df["mixed_signal"].any():  # gold set only
        out["mixed_signal"] = df["mixed_signal"].map({True: "mixed", False: "clear"})
    return out


def analyze(df):
    """df needs label, pred and the slice columns. Returns ({feature: table}, {feature: gap}, [flagged features]);
    the gap is the accuracy difference between the best and worst slice with at least MIN_SLICE_ROWS rows."""
    tables, gaps = {}, {}
    for name, feature in features(df).items():
        frame = MetricFrame(metrics=METRICS, y_true=df["label"], y_pred=df["pred"], sensitive_features=feature)
        table = frame.by_group.sort_values("accuracy", ascending=False)
        judged = table[table["rows"] >= MIN_SLICE_ROWS]
        tables[name] = table
        gaps[name] = float(judged["accuracy"].max() - judged["accuracy"].min()) if len(judged) > 1 else 0.0
    flagged = [name for name, gap in gaps.items() if gap > MAX_SLICE_GAP]
    return tables, gaps, flagged


def report(df, title, out_dir=SLICE_DIR):
    """write report.md and one chart per slice feature; returns (gaps, flagged) like analyze()"""
    out_dir.mkdir(parents=True, exist_ok=True)
    tables, gaps, flagged = analyze(df)
    lines = [f"# Slice analysis: {title}", "",
             f"{len(df)} rows. A slice needs at least {MIN_SLICE_ROWS} rows to be judged; a gap above "
             f"{MAX_SLICE_GAP:.2f} between the best and worst slice is flagged.", ""]
    for name, table in tables.items():
        lines += [f"## {name}: accuracy gap {gaps[name]:.2f}{'  (flagged)' if name in flagged else ''}", "",
                  "```", table.round(3).to_string(), "```", ""]
        fig, ax = plt.subplots(figsize=(7, 3))
        judged = table[table["rows"] >= MIN_SLICE_ROWS]
        ax.bar(judged.index.astype(str), judged["accuracy"], color="#4c8dff")
        ax.set_ylim(0, 1)
        ax.set_title(f"Accuracy by {name}")
        fig.savefig(out_dir / f"{name}.png", bbox_inches="tight")
        plt.close(fig)
    lines += [f"**Flagged: {', '.join(flagged)}.** {MITIGATION}" if flagged else "No slice falls behind."]
    (out_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return gaps, flagged
