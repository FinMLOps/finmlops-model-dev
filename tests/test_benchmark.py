import pandas as pd
import pytest

from scripts import benchmark


def test_build_keeps_scored_marketaux_in_the_window(monkeypatch, make_news):
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
    assert df["label"].tolist() == ["negative"]


def test_run_never_rebuilds_a_frozen_benchmark(tmp_path, monkeypatch):
    path = tmp_path / "benchmark_x.parquet"
    pd.DataFrame({"id": ["frozen"]}).to_parquet(path)
    monkeypatch.setattr(benchmark, "benchmark_path", lambda: path)
    monkeypatch.setattr(benchmark, "score", lambda *a: pytest.fail("should not re-score"))
    assert benchmark.run(None, None)["id"].tolist() == ["frozen"]


def test_report_has_one_f1_per_threshold():
    df = pd.DataFrame({"sentiment_score": [0.2, 0.12, -0.3], "label": ["positive", "neutral", "negative"],
                       "finbert_pred": ["positive", "positive", "negative"], "ticker": ["AAPL"] * 3})
    out = benchmark.report(df)
    assert out["bench_accuracy"] == pytest.approx(2 / 3)
    assert out["bench_f1_macro_thr10"] == 1.0  # at 0.10 the 0.12 row is positive too
    assert {"bench_f1_macro_thr15", "bench_f1_macro_thr25"} <= set(out)


def test_agreement_only_uses_marketaux_rows():
    gold = pd.DataFrame({"source": ["marketaux", "marketaux", "finnhub"], "sentiment_score": [0.5, 0.05, 0.9],
                         "label": ["positive", "negative", "negative"]})
    out = benchmark.agreement(gold)
    assert out["agreement_rows"] == 2
    assert out["agreement_thr15"] == 0.5
    assert benchmark.agreement(gold[gold["source"] == "finnhub"]) == {}
