"""Load the data pipeline's news.parquet and build labeled sets (Marketaux labels, gold set, date split).

uv run python -m scripts.data sample-gold [--force]   # write data/gold_todo.csv, the rows to hand-label
"""

import logging
import sys
from pathlib import Path

import pandas as pd
import yaml

from scripts.config import (COLUMNS, DATA_PATH, GOLD_FINNHUB_PER_TICKER, GOLD_MARKETAUX_PER_TICKER, GOLD_PATH,
                            GOLD_TODO_PATH, LABEL_THRESHOLD, LABELS, SEED, STUDY, TEST_END, TEST_START, TICKERS,
                            VAL_FRAC, setup_logging)

log = logging.getLogger(__name__)
GOLD_COLUMNS = ["id", "ticker", "label", "mixed_signal"]
YES = {"1", "true", "yes", "y", "x"}  # what counts as "yes" in the mixed_signal column


def load_news(path=DATA_PATH):
    """news.parquet, checked: expected columns and tickers, UTC timestamps, scores within -1 to 1.
    Rows with no text and duplicate (id, ticker) rows are dropped with a warning."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"{path} not found; get it with `uv run dvc pull` (see the README)")
    df = pd.read_parquet(path)
    missing = set(COLUMNS) - set(df.columns)
    if missing:
        raise ValueError(f"news.parquet is missing columns: {sorted(missing)}")
    unknown = set(df["ticker"]) - TICKERS
    if unknown:
        raise ValueError(f"unexpected tickers: {sorted(unknown)}")
    df["published"] = pd.to_datetime(df["published"], utc=True)  # comparing with TEST_START needs UTC timestamps
    scores = df["sentiment_score"]
    out_of_range = scores.notna() & ~scores.between(-1, 1)
    if out_of_range.any():
        raise ValueError(f"{out_of_range.sum()} sentiment scores are outside -1 to 1")
    empty = df["text"].fillna("").str.strip() == ""
    duplicate = df.duplicated(["id", "ticker"])
    if empty.any() or duplicate.any():
        log.warning("dropping %d rows with no text and %d duplicate rows", empty.sum(), duplicate.sum())
        df = df[~empty & ~duplicate]
    return df.reset_index(drop=True)


def score_to_label(score, threshold=LABEL_THRESHOLD):
    if pd.isna(score):
        raise ValueError("can't label a missing score")
    if score > threshold:
        return "positive"
    if score < -threshold:
        return "negative"
    return "neutral"


def load_labeled(threshold=LABEL_THRESHOLD):
    """Marketaux rows of news.parquet that have a score, with a label; the score is dropped so it can't leak"""
    news = load_news()
    df = news[(news["source"] == "marketaux") & news["sentiment_score"].notna()].copy()
    df["label"] = df["sentiment_score"].map(lambda s: score_to_label(s, threshold))
    return df.drop(columns="sentiment_score")


def split_by_date(df, val_frac=VAL_FRAC):
    """train / validation from the news before TEST_START; validation is the latest val_frac of it.
    The benchmark window itself is the test set (see benchmark.py), so it never reaches training."""
    # everything before the benchmark window; only this part is ever used for training or validation
    early = df[df["published"] < TEST_START]
    if early.empty:
        raise ValueError(f"no labeled rows before {TEST_START.date()}, so nothing to train on")

    # the timestamp that has (1 - val_frac) of the early rows before it, e.g. 90% of them for val_frac=0.1
    cut = early["published"].quantile(1 - val_frac)

    train = early[early["published"] < cut]  # oldest news: the model learns from this
    val = early[early["published"] >= cut]  # newest early news: picks the best epoch and the hyperparameters
    if train.empty or val.empty:
        raise ValueError(f"can't split {len(early)} rows into train and validation; too little data before "
                         f"{TEST_START.date()}")
    return train, val


def drop_gold(df, path=GOLD_PATH):
    """remove hand-labeled rows, so the gold set can never leak into training"""
    if not path.exists():
        return df
    gold = pd.read_csv(path, usecols=["id", "ticker"], dtype=str, keep_default_na=False)
    keys = set(zip(gold["id"].str.strip(), gold["ticker"].str.strip().str.upper()))
    return df[[key not in keys for key in zip(df["id"], df["ticker"])]]


def data_snapshot():
    """short commit hash of the data pipeline snapshot news.parquet came from (from the .dvc file)"""
    # `dvc import` wrote this small text file next to the parquet; git tracks it, the parquet itself is not in git
    dvc_file = DATA_PATH.parent / "news.parquet.dvc"
    if not dvc_file.exists():
        raise FileNotFoundError(f"{dvc_file.name} not found; import the data first")

    # the file is YAML; yaml.safe_load turns it into nested dicts and lists
    dvc = yaml.safe_load(dvc_file.read_text())

    # layout: deps -> [ {path: ..., repo: {url: ..., rev_lock: <full commit hash>}} ]
    # rev_lock is the exact data pipeline commit that news.parquet was imported from
    try:
        rev_lock = dvc["deps"][0]["repo"]["rev_lock"]
    except (KeyError, IndexError, TypeError):
        raise ValueError(f"{dvc_file.name} has no deps[0].repo.rev_lock; was it made with `dvc import`?")

    # the first 8 characters are enough to tell snapshots apart and keep file names short
    return rev_lock[:8]


def data_info():
    """which data and label rule a run used, so every run can be traced"""
    return {"data_snapshot": data_snapshot(), "test_start": str(TEST_START.date()), "label_threshold": LABEL_THRESHOLD}


def study_name():
    """one Optuna study per data snapshot and label cut-off, so trials on old data never mix with new ones"""
    return f"{STUDY}-{data_snapshot()}-thr{round(LABEL_THRESHOLD * 100):02d}"


def in_benchmark_window(df):
    """True for rows published in the frozen benchmark window [TEST_START, TEST_END)"""
    return (df["published"] >= TEST_START) & (df["published"] < TEST_END)


def sample_gold(n_finnhub=GOLD_FINNHUB_PER_TICKER, n_marketaux=GOLD_MARKETAUX_PER_TICKER, path=GOLD_TODO_PATH,
                force=False):
    """write the rows to hand-label: n Finnhub articles per ticker plus up to n Marketaux benchmark rows per ticker.

    The source and Marketaux's score are left out on purpose so they can't sway whoever labels.
    Fill in `label` (negative / neutral / positive) and `mixed_signal` (1 if the headline pulls both ways,
    else leave empty), then save the file as data/gold.csv.
    """
    if path.exists() and not force:  # it may already hold hours of hand labels
        raise FileExistsError(f"{path.name} already exists and may hold labels; use --force to overwrite it")
    news = load_news()
    finnhub = news[news["source"] == "finnhub"]
    marketaux = news[(news["source"] == "marketaux") & news["sentiment_score"].notna() & in_benchmark_window(news)]
    parts = [g.sample(min(n, len(g)), random_state=SEED)
             for df, n in [(finnhub, n_finnhub), (marketaux, n_marketaux)]
             for _, g in df.groupby("ticker")]
    if not parts:
        raise ValueError("no rows to sample from")
    out = pd.concat(parts).sample(frac=1, random_state=SEED)  # shuffled, so the order gives nothing away
    out = out[["id", "ticker", "title", "summary"]].assign(label="", mixed_signal="")
    out.to_csv(path, index=False)
    return out


def load_gold(path=GOLD_PATH):
    """hand labels (id, ticker, label, mixed_signal) joined with news.parquet for the text and everything else.
    Forgiving about typing ("Positive ", "yes") and strict about content (missing or unknown labels, duplicates)."""
    gold = pd.read_csv(path, dtype=str, keep_default_na=False)
    missing = set(GOLD_COLUMNS) - set(gold.columns)
    if missing:
        raise ValueError(f"gold.csv is missing columns: {sorted(missing)}")
    gold = gold[GOLD_COLUMNS].apply(lambda col: col.str.strip())
    gold["ticker"] = gold["ticker"].str.upper()
    gold["label"] = gold["label"].str.lower()
    unlabeled = (gold["label"] == "").sum()
    if unlabeled:
        raise ValueError(f"gold.csv has {unlabeled} rows without a label")
    bad = set(gold["label"]) - set(LABELS)
    if bad:
        raise ValueError(f"gold.csv has unknown labels: {sorted(bad)}")
    duplicates = gold.duplicated(["id", "ticker"]).sum()
    if duplicates:
        raise ValueError(f"gold.csv has {duplicates} duplicate rows")
    gold["mixed_signal"] = gold["mixed_signal"].str.lower().isin(YES)
    df = gold.merge(load_news(), on=["id", "ticker"])
    if len(df) < len(gold):
        raise ValueError(f"{len(gold) - len(df)} gold rows are not in news.parquet (run `dvc update`?)")
    return df


if __name__ == "__main__":
    setup_logging()
    args = sys.argv[1:]
    if not args or args[0] != "sample-gold" or set(args[1:]) - {"--force"}:
        sys.exit("usage: python -m scripts.data sample-gold [--force]")
    rows = sample_gold(force="--force" in args)
    print(f"wrote {len(rows)} rows to {GOLD_TODO_PATH}; label them and save as {GOLD_PATH}")
