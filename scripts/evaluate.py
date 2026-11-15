"""Predictions, metrics (macro F1, accuracy per ticker), and the champion vs challenger rule."""

import numpy as np
import torch
from sklearn.metrics import accuracy_score, precision_recall_fscore_support

from scripts import hardware, registry
from scripts.config import BOOTSTRAP_ROUNDS, CONFIDENCE, EVAL_BATCH_SIZE, LABELS, MAX_LENGTH, SEED, TOLERANCE
from scripts.data import model_input


def predict_probs(model, tokenizer, texts, batch_size=EVAL_BATCH_SIZE, max_length=MAX_LENGTH):
    """class probabilities, shape (len(texts), number of labels); columns follow model.config.id2label.
    Always in fp32 (no mixed precision), so a model's scores don't depend on which machine computed them."""
    texts = [str(t) for t in texts]
    model.eval()
    probs = [torch.empty(0, len(model.config.id2label))]  # so an empty list of texts gives an empty result
    with torch.inference_mode():
        for i in range(0, len(texts), batch_size):
            inputs = tokenizer(texts[i : i + batch_size], padding=True, truncation=True,
                               max_length=max_length, return_tensors="pt").to(model.device)
            probs.append(model(**inputs).logits.float().softmax(dim=-1).cpu())
    return torch.cat(probs)


def predict(model, tokenizer, texts):
    ids = predict_probs(model, tokenizer, texts).argmax(dim=-1).tolist()
    return [model.config.id2label[i].lower() for i in ids]


def metrics(df):
    """df needs label, pred and ticker columns (mixed_signal is optional). Macro scores always average over all
    three labels, so they stay comparable even when a small set happens to miss one."""
    if df.empty:
        raise ValueError("no rows to evaluate")
    y, pred = df["label"], df["pred"]
    p, r, f1, _ = precision_recall_fscore_support(y, pred, labels=LABELS, average="macro", zero_division=0)
    per_label = precision_recall_fscore_support(y, pred, labels=LABELS, average=None, zero_division=0)[2]
    out = {"f1_macro": f1, "precision_macro": p, "recall_macro": r, "accuracy": accuracy_score(y, pred)}
    out.update({f"f1_{label}": f for label, f in zip(LABELS, per_label)})
    for ticker, g in df.groupby("ticker"):
        out[f"accuracy_{ticker}"] = accuracy_score(g["label"], g["pred"])
    if "mixed_signal" in df and df["mixed_signal"].any():  # gold set only: headlines that pull both ways
        mixed = df[df["mixed_signal"]]
        out["mixed_signal_accuracy"] = accuracy_score(mixed["label"], mixed["pred"])
    return {k: float(v) for k, v in out.items()}


def evaluate_version(version, df):
    """metrics and predictions of a registered model version on df"""
    model, tokenizer = registry.load(version)
    df = df.assign(pred=predict(model, tokenizer, model_input(df)))
    del model
    hardware.free_memory()
    return metrics(df), df


def is_better(new, old, tol=TOLERANCE):
    """better macro F1 and not worse for any ticker; tol allows a small drop since ticker slices are small"""
    tickers = [k for k in old if k.startswith("accuracy_")]
    return new["f1_macro"] > old["f1_macro"] and all(new.get(k, 0.0) >= old[k] - tol for k in tickers)


def macro_f1(y, p, n_labels):
    """macro F1 from integer labels; rows of y / p are resamples, so this scores many bootstrap rounds at once"""
    scores = []
    for k in range(n_labels):
        tp = ((p == k) & (y == k)).sum(axis=-1)
        fp = ((p == k) & (y != k)).sum(axis=-1)
        fn = ((p != k) & (y == k)).sum(axis=-1)
        denom = 2 * tp + fp + fn
        scores.append(np.where(denom > 0, 2 * tp / np.maximum(denom, 1), 0.0))
    return np.mean(scores, axis=0)


def f1_gain(new_df, old_df, rounds=BOOTSTRAP_ROUNDS, confidence=CONFIDENCE, seed=SEED):
    """how much better the challenger's macro F1 is than the champion's, with a confidence interval.

    Paired bootstrap: both models are scored on the same resampled rows each round, so the interval reflects how
    much the gain depends on which headlines happen to be in a small test set. Returns (gain, low, high).
    """
    if len(new_df) != len(old_df) or not (new_df["label"].values == old_df["label"].values).all():
        raise ValueError("champion and challenger must be scored on the same rows")
    ids = {label: i for i, label in enumerate(LABELS)}
    y = new_df["label"].map(ids).to_numpy()
    p_new, p_old = new_df["pred"].map(ids).to_numpy(), old_df["pred"].map(ids).to_numpy()
    rows = np.random.default_rng(seed).integers(0, len(y), size=(rounds, len(y)))
    gains = macro_f1(y[rows], p_new[rows], len(LABELS)) - macro_f1(y[rows], p_old[rows], len(LABELS))
    tail = (1 - confidence) / 2 * 100
    gain = macro_f1(y, p_new, len(LABELS)) - macro_f1(y, p_old, len(LABELS))
    return float(gain), float(np.percentile(gains, tail)), float(np.percentile(gains, 100 - tail))
