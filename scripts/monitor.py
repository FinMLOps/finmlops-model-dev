"""Monitoring the deployed champion: has it decayed, or has the news drifted from what it was trained on?

uv run python -m scripts.deploy pull    # the deployed champion, from the model registry in GCS, into bundle/
uv run python -m scripts.monitor        # writes outputs/monitor.json; emails when retraining should be triggered

Decay: the champion's macro F1 on the newest Marketaux headlines (they come with a sentiment score, so they can be
labeled like the training data) against its macro F1 on the held-out benchmark window's Marketaux headlines. Same
labels, both unseen in training, so a gap means the model got worse on new news, not that the yardstick changed.
Drift: population stability index (PSI) between the training news and the newest news, for the ticker mix, the
source mix and headline length.
"""

import json
import logging
import os

import numpy as np
import pandas as pd

from scripts import registry
from scripts.config import (DECAY_DROP, DRIFT_PSI, EMBARGO, MIN_MONITOR_ROWS, MONITOR_DAYS, OUT_DIR, TEST_END,
                            TEST_START, setup_logging)
from scripts.data import load_news, model_input, score_to_label
from scripts.deploy import BUNDLE
from scripts.evaluate import metrics, predict
from scripts.pipeline import notify

log = logging.getLogger(__name__)

LENGTH_BINS = [0, 8, 12, 16, 24, 1000]  # headline length in words


def psi(ref, cur, eps=1e-4):
    """population stability index between two samples of a categorical feature; 0 means the same mix"""
    a, b = ref.value_counts(normalize=True), cur.value_counts(normalize=True)
    keys = a.index.union(b.index)
    a = a.reindex(keys, fill_value=0).clip(lower=eps)
    b = b.reindex(keys, fill_value=0).clip(lower=eps)
    return float(((b - a) * np.log(b / a)).sum())


def features(df):
    words = df["title"].fillna("").str.split().str.len()
    return {"ticker": df["ticker"], "source": df["source"],
            "title_words": pd.cut(words, LENGTH_BINS, right=False).astype(str)}


def drift(ref, cur):
    a, b = features(ref), features(cur)
    return {k: round(psi(a[k], b[k]), 4) for k in a}


def windows(news):
    """train: what the model learned from; held_out: the benchmark window, never trained on; new: the newest news
    after it, at most MONITOR_DAYS of it"""
    published = news["published"]
    train = news[published < TEST_START - EMBARGO]
    held_out = news[(published >= TEST_START) & (published < TEST_END)]
    new = news[(published >= TEST_END) & (published > published.max() - pd.Timedelta(days=MONITOR_DAYS))]
    return train, held_out, new


def scores(df, model, tokenizer):
    """the model's scores on df's Marketaux rows, labeled from their sentiment score; None if there are too few"""
    rows = df[(df["source"] == "marketaux") & df["sentiment_score"].notna()]
    if len(rows) < MIN_MONITOR_ROWS:
        return None
    rows = rows.assign(label=rows["sentiment_score"].map(score_to_label))
    m = metrics(rows.assign(pred=predict(model, tokenizer, model_input(rows))))
    return {"rows": len(rows), "f1_macro": round(m["f1_macro"], 4), "accuracy": round(m["accuracy"], 4)}


def decide(drifts, held_out, new):
    """the reasons to retrain (empty: all good)"""
    reasons = [f"{k} drifted (PSI {v:.2f} > {DRIFT_PSI})" for k, v in drifts.items() if v > DRIFT_PSI]
    if held_out and new and new["f1_macro"] < held_out["f1_macro"] - DECAY_DROP:
        reasons.append(f"macro F1 on new news fell to {new['f1_macro']:.3f}, "
                       f"from {held_out['f1_macro']:.3f} on the held-out window (allowed drop {DECAY_DROP})")
    return reasons


def run():
    version = json.loads((BUNDLE / "registry.json").read_text())["champion"]
    news = load_news()
    train, held_out, new = windows(news)
    report = {"champion": version, "news_as_of": news["published"].max().isoformat(), "new_rows": len(new),
              "drift_psi": None, "held_out": None, "new": None, "retrain": False, "reasons": []}
    if len(new) < MIN_MONITOR_ROWS:
        report["reasons"] = [f"only {len(new)} new rows after the benchmark window; nothing to judge yet"]
        return report
    model, tokenizer = registry.load_dir(BUNDLE / "model")
    report["drift_psi"] = drift(train, new)
    report["held_out"] = scores(held_out, model, tokenizer)
    report["new"] = scores(new, model, tokenizer)
    reasons = decide(report["drift_psi"], report["held_out"], report["new"])
    report.update(retrain=bool(reasons), reasons=reasons)
    return report


def main():
    setup_logging()
    report = run()
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / "monitor.json").write_text(json.dumps(report, indent=1))
    # one structured line, so the result is searchable in Cloud Logging / the Actions log
    print(json.dumps({"severity": "WARNING" if report["retrain"] else "INFO", "message": "model monitor", **report}))
    if os.getenv("GITHUB_OUTPUT"):  # the monitor workflow starts retraining when this is true
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"retrain={str(report['retrain']).lower()}\n")
    if report["retrain"]:
        notify("retraining triggered", "\n".join(report["reasons"]) + "\n\n" + json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
