import pandas as pd
import pytest

from scripts import benchmark


@pytest.fixture
def frozen(tmp_path, monkeypatch):
    """the benchmark file lives in tmp_path and the snapshot hash is fixed"""
    path = tmp_path / "benchmark.parquet"
    monkeypatch.setattr(benchmark, "benchmark_path", lambda: path)
    monkeypatch.setattr(benchmark, "data_snapshot", lambda: "abc12345")
    return path


def test_build_keeps_scored_marketaux_in_the_window(monkeypatch, frozen, make_news):
    news = make_news([
        {"id": "in", "published": "2026-11-07", "sentiment_score": -0.5},
        {"id": "early", "published": "2026-11-01"},
        {"id": "late", "published": "2026-11-13"},
        {"id": "finnhub", "source": "finnhub", "published": "2026-11-07"},
        {"id": "no-score", "published": "2026-11-07", "sentiment_score": None},
    ])
    monkeypatch.setattr(benchmark, "load_news", lambda: news)
    df = benchmark.build()
    assert df["id"].tolist() == ["in"]
    assert df["snapshot"].tolist() == ["abc12345"]
    monkeypatch.setattr(benchmark, "load_news", lambda: news[news["id"] == "early"])
    with pytest.raises(ValueError, match="no scored Marketaux rows"):
        benchmark.build()


def test_get_freezes_the_rows_once(monkeypatch, frozen, make_news):
    news = make_news([{"id": "1", "published": "2026-11-07", "sentiment_score": -0.5}])
    monkeypatch.setattr(benchmark, "load_news", lambda: news)
    assert benchmark.get()["label"].tolist() == ["negative"]
    assert frozen.exists()
    newer = make_news([{"id": "1", "published": "2026-11-07"}, {"id": "2", "published": "2026-11-08"}])
    monkeypatch.setattr(benchmark, "load_news", lambda: newer)  # e.g. after `dvc update`
    assert benchmark.get()["id"].tolist() == ["1"]  # still the frozen rows


def test_get_always_relabels_from_the_score(frozen, make_news):
    stale = make_news([{"sentiment_score": -0.5}]).assign(label="positive", snapshot="old")
    stale.to_parquet(frozen)
    assert benchmark.get()["label"].tolist() == ["negative"]  # the stored label is ignored
    pd.DataFrame({"id": ["1"]}).to_parquet(frozen)
    with pytest.raises(ValueError, match="delete it"):
        benchmark.get()


def test_load_eval_prefers_the_gold_set(tmp_path, monkeypatch):
    monkeypatch.setattr(benchmark, "GOLD_PATH", tmp_path / "gold.csv")
    monkeypatch.setattr(benchmark, "get", lambda: "benchmark")
    monkeypatch.setattr(benchmark, "load_gold", lambda: "gold")
    assert benchmark.load_eval() == "benchmark"
    (tmp_path / "gold.csv").write_text("id\n")
    assert benchmark.load_eval() == "gold"


def test_report_has_one_f1_per_threshold():
    df = pd.DataFrame({"sentiment_score": [0.2, 0.12, -0.3], "label": ["positive", "neutral", "negative"],
                       "pred": ["positive", "positive", "negative"], "ticker": ["AAPL"] * 3})
    out = benchmark.report(df)
    assert out["bench_accuracy"] == pytest.approx(2 / 3)
    assert out["bench_f1_macro_thr10"] < 1.0  # at 0.10 there are no neutral rows left, so neutral's F1 is 0
    assert {"bench_f1_macro_thr15", "bench_f1_macro_thr25"} <= set(out)


def test_agreement_only_uses_marketaux_rows():
    gold = pd.DataFrame({"source": ["marketaux", "marketaux", "finnhub"], "sentiment_score": [0.5, 0.05, 0.9],
                         "label": ["positive", "negative", "negative"]})
    out = benchmark.agreement(gold)
    assert out["agreement_rows"] == 2
    assert out["agreement_thr15"] == 0.5
    assert benchmark.agreement(gold[gold["source"] == "finnhub"]) == {}
