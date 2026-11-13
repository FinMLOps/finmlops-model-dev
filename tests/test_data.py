import pandas as pd
import pytest

from scripts import data


def test_score_to_label():
    assert data.score_to_label(0.16) == "positive"
    assert data.score_to_label(0.15) == "neutral"
    assert data.score_to_label(-0.15) == "neutral"
    assert data.score_to_label(-0.2) == "negative"
    assert data.score_to_label(0.2, threshold=0.25) == "neutral"
    with pytest.raises(ValueError, match="missing score"):
        data.score_to_label(float("nan"))


def test_load_news_checks_columns_tickers_and_scores(tmp_path, make_news):
    path = tmp_path / "news.parquet"
    with pytest.raises(FileNotFoundError, match="dvc pull"):
        data.load_news(path)
    make_news([{}]).drop(columns="sentiment_score").to_parquet(path)
    with pytest.raises(ValueError, match="missing columns"):
        data.load_news(path)
    make_news([{"ticker": "IBM"}]).to_parquet(path)
    with pytest.raises(ValueError, match="unexpected tickers"):
        data.load_news(path)
    make_news([{"sentiment_score": 1.5}]).to_parquet(path)
    with pytest.raises(ValueError, match="outside -1 to 1"):
        data.load_news(path)


def test_load_news_cleans_rows_and_timestamps(tmp_path, make_news):
    path = tmp_path / "news.parquet"
    df = make_news([{"id": "1"}, {"id": "1"}, {"id": "2", "text": "  "}, {"id": "3"}])
    df["published"] = df["published"].dt.tz_localize(None)  # timestamps without a time zone
    df.to_parquet(path)
    news = data.load_news(path)
    assert news["id"].tolist() == ["1", "3"]  # duplicate and empty text dropped
    assert str(news["published"].dt.tz) == "UTC"


def test_load_labeled_keeps_scored_marketaux_and_drops_score(monkeypatch, make_news):
    news = make_news([{"id": "1"}, {"id": "2", "sentiment_score": None}, {"id": "3", "source": "finnhub"}])
    monkeypatch.setattr(data, "load_news", lambda: news)
    df = data.load_labeled()
    assert df["id"].tolist() == ["1"]
    assert df["label"].tolist() == ["positive"]
    assert "sentiment_score" not in df


def test_split_by_date_never_mixes_past_and_future(make_news):
    days = ["2026-10-20", "2026-10-25", "2026-10-30", "2026-11-03", "2026-11-05", "2026-11-07", "2026-11-13"]
    df = make_news([{"id": str(i), "published": d} for i, d in enumerate(days)])
    train, val = data.split_by_date(df, val_frac=0.2)
    assert train["published"].max() < val["published"].min()
    assert val["published"].max() < data.TEST_START  # the benchmark window and later never reach training
    assert len(train) + len(val) == 5
    with pytest.raises(ValueError, match="nothing to train on"):
        data.split_by_date(df[df["published"] >= data.TEST_START])


def test_drop_gold(tmp_path, make_news):
    df = make_news([{"id": "1"}, {"id": "2"}, {"id": "1", "ticker": "MSFT"}])
    path = tmp_path / "gold.csv"
    assert data.drop_gold(df, path) is df  # no gold set yet
    path.write_text("id,ticker,label\n1, aapl ,positive\n")
    assert data.drop_gold(df, path)["id"].tolist() == ["2", "1"]  # only (1, AAPL) is gold


def test_data_snapshot_and_study_name(tmp_path, monkeypatch):
    monkeypatch.setattr(data, "DATA_PATH", tmp_path / "news.parquet")
    with pytest.raises(FileNotFoundError):
        data.data_snapshot()
    dvc = tmp_path / "news.parquet.dvc"
    dvc.write_text("deps:\n- path: x\n  repo:\n    url: u\n    rev_lock: 399df0baf5ad2aed\n")
    assert data.data_snapshot() == "399df0ba"
    assert data.study_name() == "finbert-lora-399df0ba-thr15"
    dvc.write_text("outs: []\n")
    with pytest.raises(ValueError, match="rev_lock"):
        data.data_snapshot()


GOLD_HEADER = "id,ticker,title,summary,label,mixed_signal\n"


def test_load_gold_forgives_typing(tmp_path, monkeypatch, make_news):
    monkeypatch.setattr(data, "load_news", lambda: make_news([{"id": "1"}, {"id": "2"}]))
    path = tmp_path / "gold.csv"
    path.write_text(GOLD_HEADER + "1,aapl,t,s, Positive ,yes\n2,AAPL,t,s,neutral,\n")
    gold = data.load_gold(path)
    assert gold["label"].tolist() == ["positive", "neutral"]
    assert gold["mixed_signal"].tolist() == [True, False]
    assert gold["text"].tolist() == ["t s", "t s"]  # text comes from news.parquet


@pytest.mark.parametrize("rows, error", [
    ("1,AAPL,t,s,,\n", "without a label"),
    ("1,AAPL,t,s,great,\n", "unknown labels"),
    ("9,AAPL,t,s,positive,\n", "not in news.parquet"),
    ("1,AAPL,t,s,positive,\n1,AAPL,t,s,negative,\n", "duplicate"),
])
def test_load_gold_rejects_bad_files(tmp_path, monkeypatch, make_news, rows, error):
    monkeypatch.setattr(data, "load_news", lambda: make_news([{"id": "1"}]))
    path = tmp_path / "gold.csv"
    path.write_text(GOLD_HEADER + rows)
    with pytest.raises(ValueError, match=error):
        data.load_gold(path)
    path.write_text("id,ticker,label\n1,AAPL,positive\n")
    with pytest.raises(ValueError, match="missing columns"):
        data.load_gold(path)


def test_sample_gold(tmp_path, monkeypatch, make_news):
    rows = [{"id": f"f{i}", "source": "finnhub", "ticker": t} for t in ["AAPL", "MSFT"] for i in range(5)]
    rows += [{"id": "m-in", "published": "2026-11-07"}, {"id": "m-early", "published": "2026-10-01"}]
    monkeypatch.setattr(data, "load_news", lambda: make_news(rows))
    path = tmp_path / "todo.csv"
    out = data.sample_gold(n_finnhub=3, n_marketaux=2, path=path)
    finnhub = out[out["id"].str.startswith("f")]
    assert finnhub["ticker"].value_counts().to_dict() == {"AAPL": 3, "MSFT": 3}
    assert "m-in" in set(out["id"]) and "m-early" not in set(out["id"])
    assert list(out.columns) == ["id", "ticker", "title", "summary", "label", "mixed_signal"]
    assert pd.read_csv(path).shape == (7, 6)


def test_sample_gold_never_overwrites_labels_by_accident(tmp_path, monkeypatch, make_news):
    monkeypatch.setattr(data, "load_news", lambda: make_news([{"source": "finnhub"}]))
    path = tmp_path / "todo.csv"
    path.write_text("half-labeled work")
    with pytest.raises(FileExistsError, match="--force"):
        data.sample_gold(path=path)
    assert path.read_text() == "half-labeled work"
    data.sample_gold(path=path, force=True)
    assert path.read_text().startswith("id,ticker")
