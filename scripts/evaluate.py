"""Predictions, metrics (macro F1, accuracy per ticker), and the champion vs challenger rule."""

import torch
from sklearn.metrics import accuracy_score, precision_recall_fscore_support

from scripts import hardware, registry
from scripts.config import EVAL_BATCH_SIZE, LABELS, MAX_LENGTH, TOLERANCE


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
    df = df.assign(pred=predict(model, tokenizer, df["text"].tolist()))
    del model
    hardware.free_memory()
    return metrics(df), df


def is_better(new, old, tol=TOLERANCE):
    """better macro F1 and not worse for any ticker; tol allows a small drop since ticker slices are small"""
    tickers = [k for k in old if k.startswith("accuracy_")]
    return new["f1_macro"] > old["f1_macro"] and all(new.get(k, 0.0) >= old[k] - tol for k in tickers)
