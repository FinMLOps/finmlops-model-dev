"""Predictions, metrics (macro F1, accuracy per ticker), and the champion vs challenger rule."""

import torch
from sklearn.metrics import accuracy_score, precision_recall_fscore_support

from scripts import registry
from scripts.config import MAX_LENGTH, TOLERANCE


def predict_probs(model, tokenizer, texts, batch_size=32, max_length=MAX_LENGTH):
    """class probabilities, shape (len(texts), 3); columns follow model.config.id2label"""
    model.eval()
    probs = []
    with torch.inference_mode():
        for i in range(0, len(texts), batch_size):
            inputs = tokenizer(texts[i : i + batch_size], padding=True, truncation=True,
                               max_length=max_length, return_tensors="pt").to(model.device)
            probs.append(model(**inputs).logits.softmax(dim=-1).cpu())
    return torch.cat(probs)


def predict(model, tokenizer, texts):
    ids = predict_probs(model, tokenizer, texts).argmax(dim=-1).tolist()
    return [model.config.id2label[i] for i in ids]


def metrics(df):
    """df needs label, pred and ticker columns (mixed_signal is optional)"""
    p, r, f1, _ = precision_recall_fscore_support(df["label"], df["pred"], average="macro", zero_division=0)
    out = {"f1_macro": f1, "precision_macro": p, "recall_macro": r,
           "accuracy": accuracy_score(df["label"], df["pred"])}
    for ticker, g in df.groupby("ticker"):
        out[f"accuracy_{ticker}"] = accuracy_score(g["label"], g["pred"])
    if "mixed_signal" in df and df["mixed_signal"].any():  # gold set only: headlines that pull both ways
        mixed = df[df["mixed_signal"]]
        out["mixed_signal_accuracy"] = accuracy_score(mixed["label"], mixed["pred"])
    return out


def evaluate_version(version, df):
    """metrics and predictions of a registered model version on df"""
    model, tokenizer = registry.load(version)
    df = df.assign(pred=predict(model, tokenizer, df["text"].tolist()))
    return metrics(df), df


def is_better(new, old, tol=TOLERANCE):
    """better macro F1 and not worse for any ticker; tol allows a small drop since ticker slices are small"""
    tickers = [k for k in old if k.startswith("accuracy_")]
    return new["f1_macro"] > old["f1_macro"] and all(new[k] >= old[k] - tol for k in tickers)
