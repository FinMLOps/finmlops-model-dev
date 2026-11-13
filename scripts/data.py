"""Load the data pipeline's news.parquet and build labeled sets (Marketaux labels, gold set, date split).

uv run python -m scripts.data sample-gold   # write data/gold_todo.csv, the rows to hand-label
"""

import sys

import pandas as pd
import yaml

from scripts.config import (COLUMNS, DATA_PATH, GOLD_FINNHUB_PER_TICKER, GOLD_MARKETAUX_PER_TICKER, GOLD_PATH,
                            GOLD_TODO_PATH, LABEL_THRESHOLD, LABELS, ROOT, SEED, TEST_END, TEST_START, TICKERS,
                            VAL_FRAC)


def load_news(path=DATA_PATH):
    df = pd.read_parquet(path)
    missing = set(COLUMNS) - set(df.columns)
    if missing:
        raise ValueError(f"news.parquet is missing columns: {sorted(missing)}")
    unknown = set(df["ticker"]) - TICKERS
    if unknown:
        raise ValueError(f"unexpected tickers: {sorted(unknown)}")
    return df


def score_to_label(score, threshold=LABEL_THRESHOLD):
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
    """train/val = news before TEST_START (val is the latest val_frac of it); test = the frozen benchmark window"""
    p = df["published"]  # publish time of every row (UTC)

    # everything before the benchmark window; only this part is ever used for training or validation
    early = df[p < TEST_START]

    # the timestamp that has (1 - val_frac) of the early rows before it, e.g. 90% of them for val_frac=0.1
    cut = early["published"].quantile(1 - val_frac)

    # the frozen benchmark window [TEST_START, TEST_END); rows after TEST_END are in no split at all
    test = df[(p >= TEST_START) & (p < TEST_END)]

    train = early[early["published"] < cut]  # oldest news: the model learns from this
    val = early[early["published"] >= cut]  # newest early news: used to pick hyperparameters, just before the test window
    return train, val, test


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


def benchmark_path():
    return ROOT / "data" / f"benchmark_{data_snapshot()}.parquet"


def load_benchmark():
    path = benchmark_path()
    if not path.exists():
        raise FileNotFoundError(f"{path.name} not found; run `uv run python -m scripts.train baseline` first")
    return pd.read_parquet(path)


def data_info():
    """which data and label rule a run used, so every run can be traced"""
    return {"data_snapshot": data_snapshot(), "test_start": str(TEST_START.date()), "label_threshold": LABEL_THRESHOLD}


def in_benchmark_window(df):
    """True for rows published in the frozen benchmark window [TEST_START, TEST_END)"""
    return (df["published"] >= TEST_START) & (df["published"] < TEST_END)


def sample_gold(n_finnhub=GOLD_FINNHUB_PER_TICKER, n_marketaux=GOLD_MARKETAUX_PER_TICKER, path=GOLD_TODO_PATH):
    """write the rows to hand-label: n Finnhub articles per ticker plus up to n Marketaux benchmark rows per ticker.

    The source and Marketaux's score are left out on purpose so they can't sway whoever labels.
    Fill in `label` (negative / neutral / positive) and `mixed_signal` (1 if the headline pulls both ways,
    else leave empty), then save the file as data/gold.csv.
    """
    news = load_news()
    finnhub = news[news["source"] == "finnhub"]
    marketaux = news[(news["source"] == "marketaux") & news["sentiment_score"].notna() & in_benchmark_window(news)]
    parts = [g.sample(min(n, len(g)), random_state=SEED)
             for df, n in [(finnhub, n_finnhub), (marketaux, n_marketaux)]
             for _, g in df.groupby("ticker")]
    out = pd.concat(parts).sample(frac=1, random_state=SEED)  # shuffled, so the order gives nothing away
    out = out[["id", "ticker", "title", "summary"]].assign(label="", mixed_signal="")
    out.to_csv(path, index=False)
    return out


def load_gold(path=GOLD_PATH):
    """hand labels (id, ticker, label, mixed_signal) joined with news.parquet for the text and everything else"""
    gold = pd.read_csv(path, dtype={"id": str, "label": str}, keep_default_na=False)
    gold = gold[["id", "ticker", "label", "mixed_signal"]]
    unlabeled = (gold["label"].str.strip() == "").sum()
    if unlabeled:
        raise ValueError(f"gold.csv has {unlabeled} rows without a label")
    bad = set(gold["label"]) - set(LABELS)
    if bad:
        raise ValueError(f"gold.csv has unknown labels: {sorted(bad)}")
    gold["mixed_signal"] = gold["mixed_signal"].astype(str).str.strip().isin(["1", "true", "True", "yes"])
    df = gold.merge(load_news(), on=["id", "ticker"])
    if len(df) < len(gold):
        raise ValueError(f"{len(gold) - len(df)} gold rows are not in news.parquet (run `dvc update`?)")
    return df


def load_eval():
    """the set champion and challenger are compared on: gold if we have it, else the frozen benchmark"""
    if GOLD_PATH.exists():
        return load_gold()
    return load_benchmark()


if __name__ == "__main__":
    if sys.argv[1:] != ["sample-gold"]:
        sys.exit("usage: python -m scripts.data sample-gold")
    rows = sample_gold()
    print(f"wrote {len(rows)} rows to {GOLD_TODO_PATH}; label them and save as {GOLD_PATH}")
