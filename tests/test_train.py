from types import SimpleNamespace
from unittest.mock import MagicMock

import optuna
import pandas as pd
import pytest
import torch

from scripts import train

P = {"lr": 0.5, "epochs": 8, "batch_size": 8}


class Batch(dict):
    def to(self, device):
        return self


class Tokenizer:
    """one number per headline: +1 if it says "up", -1 if it says "down", 0 otherwise"""
    def __call__(self, texts, **kwargs):
        return Batch(x=torch.tensor([[1.0 if "up" in t else -1.0 if "down" in t else 0.0] for t in texts]))


class Model(torch.nn.Module):
    """a tiny stand-in for FinBERT with the same interface (config, device, .logits)"""
    def __init__(self, broken=False):
        super().__init__()
        self.linear = torch.nn.Linear(1, 3)
        self.broken = broken
        self.config = SimpleNamespace(label2id={"positive": 0, "negative": 1, "neutral": 2},
                                      id2label={0: "positive", 1: "negative", 2: "neutral"})

    @property
    def device(self):
        return torch.device("cpu")

    def forward(self, x):
        logits = self.linear(x)
        return SimpleNamespace(logits=logits * float("nan") if self.broken else logits)


def headlines(n=12):
    rows = [(f"shares up {i}", "positive") for i in range(n)] + [(f"shares down {i}", "negative") for i in range(n)]
    rows += [(f"meeting on tuesday {i}", "neutral") for i in range(n)]
    return pd.DataFrame(rows, columns=["text", "label"]).assign(ticker="AAPL")


@pytest.fixture(autouse=True)
def no_mlflow(monkeypatch):
    monkeypatch.setattr(train, "mlflow", MagicMock())
    return train.mlflow


def test_class_weights_balance_the_classes():
    w = train.class_weights(torch.tensor([0, 0, 0, 1]), 3)
    assert torch.isclose(w[1], 3 * w[0])  # the rare class weighs 3x more
    assert torch.isclose(w[0], torch.tensor(4 / 9))  # 4 rows / (3 classes * 3 rows)
    assert torch.isfinite(w).all()  # a class with no rows doesn't divide by zero


def test_fit_learns_and_logs_every_epoch(no_mlflow):
    torch.manual_seed(0)
    df = headlines()
    model = train.fit(Model(), Tokenizer(), df, df, P)
    pred = train.predict(model, Tokenizer(), ["stock up", "stock down", "board meeting"])
    assert pred == ["positive", "negative", "neutral"]
    assert no_mlflow.log_metrics.call_count == P["epochs"]
    no_mlflow.log_metric.assert_called_once()  # best_epoch


def test_fit_restores_the_best_epoch(monkeypatch):
    """the validation F1 goes 0.5, 0.9, 0.3: the model that comes back must be the one from epoch 2"""
    snapshots = []

    def fake_predict(model, tokenizer, texts):
        snapshots.append(model.linear.weight.detach().clone())
        return ["neutral"] * len(texts)

    scores = iter([0.5, 0.9, 0.3])
    monkeypatch.setattr(train, "predict", fake_predict)
    monkeypatch.setattr(train, "metrics", lambda df: {"f1_macro": next(scores)})
    model = train.fit(Model(), Tokenizer(), headlines(), headlines(), {**P, "epochs": 3})
    assert torch.equal(model.linear.weight, snapshots[1])
    assert not torch.equal(model.linear.weight, snapshots[2])


def test_fit_stops_when_the_loss_is_nan():
    with pytest.raises(FloatingPointError, match="lower lr"):
        train.fit(Model(broken=True), Tokenizer(), headlines(), headlines(), P)


def test_fit_needs_rows():
    with pytest.raises(ValueError, match="no training"):
        train.fit(Model(), Tokenizer(), headlines().iloc[:0], headlines(), P)


def test_a_diverged_optuna_trial_is_skipped(monkeypatch):
    def diverge(*args, **kwargs):
        raise FloatingPointError("loss became nan")

    monkeypatch.setattr(train, "train", diverge)
    trial = optuna.create_study().ask()
    with pytest.raises(optuna.TrialPruned):
        train.objective(trial)


@pytest.mark.parametrize("args", [["tune", "ten"], ["baseline", "x"], ["nope"]])
def test_cli_rejects_bad_arguments(args):
    with pytest.raises(SystemExit):
        train.main(args)


def test_llm_labels_join_training_only_when_they_pass_the_gold_check(tmp_path, monkeypatch, make_news):
    story = lambda i, day, **kw: {"id": i, "title": f"story {i}", "url": f"https://news/{i}", "published": day, **kw}
    marketaux = make_news([story("m", "2026-10-10"), story("m2", "2026-10-20")])
    llm = make_news([story("f", "2026-10-15", source="finnhub")]).drop(columns="sentiment_score")
    monkeypatch.setattr(train, "load_labeled", lambda: marketaux.assign(label="positive", label_source="marketaux"))
    monkeypatch.setattr(train.llm_labels, "training_rows", lambda: llm.assign(label="negative", label_source="llm"))
    monkeypatch.setattr(train, "LLM_LABELS_PATH", tmp_path / "llm.parquet")
    (tmp_path / "llm.parquet").write_text("exists")
    monkeypatch.setattr(train, "GOLD_PATH", tmp_path / "gold.csv")
    (tmp_path / "gold.csv").write_text("exists")
    gold = {"labeled_by": "human"}
    monkeypatch.setattr(train, "load_gold", lambda: make_news([story("g", "2026-11-07", **gold)]))
    monkeypatch.setattr(train, "drop_gold", lambda df: df)
    monkeypatch.setattr(train.benchmark, "get", lambda: make_news([story("b", "2026-11-07")]))
    monkeypatch.setattr(train.benchmark, "marketaux_kappa", lambda gold: 0.4)

    monkeypatch.setattr(train.llm_labels, "agreement", lambda gold: {"kappa": 0.5})  # better than Marketaux
    tr, va, info = train.training_data()
    assert "llm" in set(pd.concat([tr, va])["label_source"])
    monkeypatch.setattr(train.llm_labels, "agreement", lambda gold: {"kappa": 0.3})  # worse
    tr, va, info = train.training_data()
    assert set(pd.concat([tr, va])["label_source"]) == {"marketaux"}
    assert info["llm_kappa"] == 0.3 and info["marketaux_kappa"] == 0.4
    gold["labeled_by"] = "gemini:flash"  # an LLM-labeled gold set can't vouch for LLM labels
    monkeypatch.setattr(train.llm_labels, "agreement", lambda gold: {"kappa": 0.99})
    tr, va, info = train.training_data()
    assert set(pd.concat([tr, va])["label_source"]) == {"marketaux"}


def test_gold_split_trains_on_the_older_gold_rows(tmp_path, monkeypatch, make_news):
    from scripts import data

    story = lambda i, day: {"id": i, "title": f"story {i}", "url": f"https://news/{i}", "published": day}
    gold = make_news([story("g1", "2026-11-07"), story("g2", "2026-11-09T12:00"),
                      story("g3", "2026-11-10T08:00")]).assign(label="neutral")
    marketaux = make_news([story("m", "2026-10-10"), story("m2", "2026-10-20")])
    monkeypatch.setattr(train, "load_gold", lambda: gold)
    monkeypatch.setattr(train, "load_labeled", lambda: marketaux.assign(label="positive", label_source="marketaux"))
    monkeypatch.setattr(train, "drop_gold", lambda df: df)
    monkeypatch.setattr(train, "GOLD_PATH", tmp_path / "gold.csv")
    (tmp_path / "gold.csv").write_text("exists")
    split = pd.Timestamp("2026-11-10", tz="UTC")
    monkeypatch.setattr(train, "GOLD_SPLIT", split)
    monkeypatch.setattr(data, "GOLD_SPLIT", split)

    tr, va, info = train.training_data()
    assert tr["id"].tolist() == ["g1"] and va["id"].tolist() == ["g2"]  # g3 is the eval set
    assert info["label_sources"] == "gold: 1"
    monkeypatch.setattr(train, "GOLD_SPLIT_MARKETAUX", True)
    tr, va, info = train.training_data()
    assert set(tr["label_source"]) == {"gold", "marketaux"} and va["id"].tolist() == ["g2"]


@pytest.mark.parametrize("on", [True, False])
def test_class_weights_can_be_turned_off(monkeypatch, on):
    seen = []
    real = train.F.cross_entropy

    def spy(logits, target, weight=None):
        seen.append(weight)
        return real(logits, target, weight=weight)

    monkeypatch.setattr(train.F, "cross_entropy", spy)
    monkeypatch.setattr(train, "CLASS_WEIGHTS", on)
    train.fit(Model(), Tokenizer(), headlines(), headlines(), {**P, "epochs": 1})
    assert all((w is not None) == on for w in seen)
