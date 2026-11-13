from types import SimpleNamespace

import pandas as pd
import pytest
import torch

from scripts.evaluate import is_better, metrics, predict, predict_probs


def test_metrics_overall_per_label_and_per_ticker():
    df = pd.DataFrame({"label": ["positive", "negative", "neutral", "positive"],
                       "pred": ["positive", "negative", "neutral", "neutral"],
                       "ticker": ["AAPL", "AAPL", "MSFT", "MSFT"]})
    m = metrics(df)
    assert m["accuracy"] == 0.75
    assert m["accuracy_AAPL"] == 1.0 and m["accuracy_MSFT"] == 0.5
    assert m["f1_negative"] == 1.0 and m["f1_neutral"] == pytest.approx(2 / 3)
    assert "mixed_signal_accuracy" not in m
    m = metrics(df.assign(mixed_signal=[True, False, False, True]))
    assert m["mixed_signal_accuracy"] == 0.5
    with pytest.raises(ValueError, match="no rows"):
        metrics(df.iloc[:0])


def test_is_better():
    old = {"f1_macro": 0.70, "accuracy_AAPL": 0.80, "accuracy_MSFT": 0.80}
    assert is_better({"f1_macro": 0.75, "accuracy_AAPL": 0.79, "accuracy_MSFT": 0.80}, old)  # within tolerance
    assert not is_better({"f1_macro": 0.75, "accuracy_AAPL": 0.70, "accuracy_MSFT": 0.95}, old)  # one ticker worse
    assert not is_better({"f1_macro": 0.70, "accuracy_AAPL": 0.90, "accuracy_MSFT": 0.90}, old)  # equal F1 isn't better
    assert not is_better({"f1_macro": 0.75, "accuracy_AAPL": 0.90}, old)  # a missing ticker counts as worse


class Batch(dict):
    def to(self, device):
        return self


class FakeTokenizer:
    def __call__(self, texts, **kwargs):
        return Batch(n=torch.tensor([float(len(t)) for t in texts]))


class FakeModel(torch.nn.Module):
    """long texts come out positive, short ones negative; labels in upper case like some models have"""
    config = SimpleNamespace(id2label={0: "POSITIVE", 1: "Negative", 2: "neutral"})
    device = torch.device("cpu")

    def forward(self, n):
        logits = torch.stack([n - 5, 5 - n, torch.zeros_like(n)], dim=1)
        return SimpleNamespace(logits=logits)


def test_predict_batches_and_maps_labels():
    texts = ["a fairly long headline", "ok", "another long headline"]
    probs = predict_probs(FakeModel(), FakeTokenizer(), texts, batch_size=2)
    assert probs.shape == (3, 3)
    assert torch.allclose(probs.sum(dim=1), torch.ones(3))
    assert predict(FakeModel(), FakeTokenizer(), texts) == ["positive", "negative", "positive"]
    assert predict_probs(FakeModel(), FakeTokenizer(), []).shape == (0, 3)
