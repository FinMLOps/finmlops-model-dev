"""Frozen benchmark: the held-out Marketaux rows from TEST_START to TEST_END, the test set for every model.

The rows are saved once to data/benchmark_<start>_<end>.parquet and never rebuilt, so every model is compared on
exactly the same articles, even after `dvc update` brings in newer data or late-arriving articles. Only the rows are
frozen: labels are made from the stored Marketaux score each time the file is read, so they always follow
LABEL_THRESHOLD, and predictions are always made fresh by the model being scored.

uv run python -m scripts.benchmark   # build the file if needed; with data/gold.csv, also Marketaux vs hand labels
"""

import logging

import pandas as pd
from sklearn.metrics import accuracy_score, cohen_kappa_score

from scripts.config import COLUMNS, GOLD_PATH, ROOT, TEST_END, TEST_START, THRESHOLDS, setup_logging
from scripts.data import data_snapshot, in_benchmark_window, load_gold, load_news, score_to_label
from scripts.evaluate import metrics

log = logging.getLogger(__name__)


def thr(t):
    """metric-name suffix for a threshold: 0.15 -> thr15"""
    return f"thr{round(t * 100):02d}"


def benchmark_path():
    return ROOT / "data" / f"benchmark_{TEST_START:%Y%m%d}_{TEST_END:%Y%m%d}.parquet"


def build():
    """the Marketaux rows with a score in the benchmark window, and the data snapshot they came from"""
    news = load_news()
    keep = (news["source"] == "marketaux") & news["sentiment_score"].notna() & in_benchmark_window(news)
    df = news[keep].reset_index(drop=True)
    if df.empty:
        raise ValueError(f"no scored Marketaux rows from {TEST_START.date()} to {TEST_END.date()}")
    return df.assign(snapshot=data_snapshot())


def get():
    """the frozen benchmark with labels from the current LABEL_THRESHOLD; built and saved the first time"""
    path = benchmark_path()
    if path.exists():
        df = pd.read_parquet(path)
    else:
        df = build()
        tmp = path.with_suffix(".tmp")
        df.to_parquet(tmp, index=False)
        tmp.replace(path)  # written in one step, so a crash can't leave half a file behind
        log.info("froze %d benchmark rows in %s", len(df), path.name)
    missing = set(COLUMNS) - set(df.columns)
    if missing:
        raise ValueError(f"{path.name} is missing columns {sorted(missing)}; delete it so it gets rebuilt")
    return df.assign(label=df["sentiment_score"].map(score_to_label))


def load_eval():
    """the set champion and challenger are compared on: the gold set once it exists, else the frozen benchmark"""
    return load_gold() if GOLD_PATH.exists() else get()


def report(df):
    """metrics on the benchmark (df needs a pred column), plus macro F1 if the label cut-off were different"""
    out = {f"bench_{k}": v for k, v in metrics(df).items()}
    for t in THRESHOLDS:
        relabeled = df.assign(label=df["sentiment_score"].map(lambda s: score_to_label(s, t)))
        out[f"bench_f1_macro_{thr(t)}"] = metrics(relabeled)["f1_macro"]
    return out


def agreement(gold):
    """how often Marketaux's score, turned into a label, matches our hand label (accuracy and Cohen's kappa)"""
    rows = gold[(gold["source"] == "marketaux") & gold["sentiment_score"].notna()]
    if rows.empty:
        return {}
    out = {"agreement_rows": len(rows)}
    for t in THRESHOLDS:
        auto = rows["sentiment_score"].map(lambda s: score_to_label(s, t))
        out[f"agreement_{thr(t)}"] = accuracy_score(rows["label"], auto)
        out[f"kappa_{thr(t)}"] = cohen_kappa_score(rows["label"], auto)
    return out


if __name__ == "__main__":
    setup_logging()
    bench = get()
    print(f"benchmark: {len(bench)} rows, labels {bench['label'].value_counts().to_dict()}")
    if not GOLD_PATH.exists():
        raise SystemExit(f"no {GOLD_PATH.name} yet; run `uv run python -m scripts.data sample-gold` and label it")
    for k, v in agreement(load_gold()).items():
        print(f"{k:>16}  {v:.3f}" if isinstance(v, float) else f"{k:>16}  {v}")
