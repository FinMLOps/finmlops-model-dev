"""Frozen benchmark: held-out Marketaux rows (TEST_START to TEST_END), labeled from the score, scored by pretrained FinBERT.

The file is named after the data snapshot (data/benchmark_<hash>.parquet) and is never rebuilt once it exists,
so every model is compared on exactly the same rows. It is built by `uv run python -m scripts.train baseline`.

uv run python -m scripts.benchmark   # how often Marketaux agrees with the hand labels (needs data/gold.csv)
"""

import pandas as pd
from sklearn.metrics import accuracy_score, cohen_kappa_score

from scripts.config import GOLD_PATH, THRESHOLDS
from scripts.data import benchmark_path, in_benchmark_window, load_gold, load_news, score_to_label
from scripts.evaluate import metrics, predict_probs


def thr(t):
    """metric-name suffix for a threshold: 0.15 -> thr15"""
    return f"thr{round(t * 100):02d}"


def build():
    """the benchmark rows with their label (the score stays in the file for the threshold check, never a model input)"""
    news = load_news()
    keep = (news["source"] == "marketaux") & news["sentiment_score"].notna() & in_benchmark_window(news)
    df = news[keep].reset_index(drop=True)
    df["label"] = df["sentiment_score"].map(score_to_label)
    return df


def score(df, model, tokenizer):
    """add FinBERT's class probabilities and its prediction"""
    probs = predict_probs(model, tokenizer, df["text"].tolist()).numpy()
    names = [model.config.id2label[i] for i in range(probs.shape[1])]
    df = df.copy()
    for i, name in enumerate(names):
        df[f"p_{name}"] = probs[:, i]
    df["finbert_pred"] = [names[i] for i in probs.argmax(axis=1)]
    return df


def run(model, tokenizer):
    """load the frozen benchmark, or build + score + save it the first time"""
    path = benchmark_path()
    if path.exists():
        return pd.read_parquet(path)
    df = score(build(), model, tokenizer)
    df.to_parquet(path, index=False)
    return df


def report(df):
    """baseline metrics on the benchmark, plus macro F1 if the label cut-off were different"""
    out = {f"bench_{k}": v for k, v in metrics(df.assign(pred=df["finbert_pred"])).items()}
    for t in THRESHOLDS:
        relabeled = df.assign(label=df["sentiment_score"].map(lambda s: score_to_label(s, t)), pred=df["finbert_pred"])
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
    if not GOLD_PATH.exists():
        raise SystemExit(f"{GOLD_PATH.name} not found; run `uv run python -m scripts.data sample-gold` and label it")
    for k, v in agreement(load_gold()).items():
        print(f"{k:>16}  {v:.3f}" if isinstance(v, float) else f"{k:>16}  {v}")
