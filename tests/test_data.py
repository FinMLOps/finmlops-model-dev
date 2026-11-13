import pytest

from scripts import data


def test_score_to_label():
    assert data.score_to_label(0.16) == "positive"
    assert data.score_to_label(0.15) == "neutral"
    assert data.score_to_label(-0.15) == "neutral"
    assert data.score_to_label(-0.2) == "negative"
    assert data.score_to_label(0.2, threshold=0.25) == "neutral"


def test_load_news_checks_columns_and_tickers(tmp_path, make_news):
    path = tmp_path / "news.parquet"
    make_news([{}]).drop(columns="sentiment_score").to_parquet(path)
    with pytest.raises(ValueError, match="missing columns"):
        data.load_news(path)
    make_news([{"ticker": "IBM"}]).to_parquet(path)
    with pytest.raises(ValueError, match="unexpected tickers"):
        data.load_news(path)


def test_load_labeled_keeps_scored_marketaux_and_drops_score(monkeypatch, make_news):
    news = make_news([{"id": "1"}, {"id": "2", "sentiment_score": None}, {"id": "3", "source": "finnhub"}])
    monkeypatch.setattr(data, "load_news", lambda: news)
    df = data.load_labeled()
    assert df["id"].tolist() == ["1"]
    assert df["label"].tolist() == ["positive"]
    assert "sentiment_score" not in df


def test_split_by_date_never_mixes_past_and_future(make_news):
    days = ["2026-10-20", "2026-10-25", "2026-10-30", "2026-11-03", "2026-11-05",
            "2026-11-07", "2026-11-11", "2026-11-13"]
    df = make_news([{"id": str(i), "published": d} for i, d in enumerate(days)])
    train, val, test = data.split_by_date(df, val_frac=0.2)
    assert train["published"].max() < val["published"].min()
    assert val["published"].max() < data.TEST_START
    assert test["id"].tolist() == ["5", "6"]  # 13 Nov is after TEST_END, so it's in no split
    assert len(train) + len(val) == 5


def test_data_snapshot(tmp_path, monkeypatch):
    monkeypatch.setattr(data, "DATA_PATH", tmp_path / "news.parquet")
    with pytest.raises(FileNotFoundError):
        data.data_snapshot()
    dvc = tmp_path / "news.parquet.dvc"
    dvc.write_text("deps:\n- path: x\n  repo:\n    url: u\n    rev_lock: 399df0baf5ad2aed\n")
    assert data.data_snapshot() == "399df0ba"
    dvc.write_text("outs: []\n")
    with pytest.raises(ValueError, match="rev_lock"):
        data.data_snapshot()


GOLD_HEADER = "id,ticker,title,summary,label,mixed_signal\n"


def test_load_gold(tmp_path, monkeypatch, make_news):
    monkeypatch.setattr(data, "load_news", lambda: make_news([{"id": "1"}, {"id": "2"}]))
    path = tmp_path / "gold.csv"
    path.write_text(GOLD_HEADER + "1,AAPL,t,s,positive,1\n2,AAPL,t,s,neutral,\n")
    gold = data.load_gold(path)
    assert gold["mixed_signal"].tolist() == [True, False]
    assert gold["text"].tolist() == ["t s", "t s"]  # text comes from news.parquet


@pytest.mark.parametrize("row, error", [
    ("1,AAPL,t,s,,\n", "without a label"),
    ("1,AAPL,t,s,great,\n", "unknown labels"),
    ("9,AAPL,t,s,positive,\n", "not in news.parquet"),
])
def test_load_gold_rejects_bad_files(tmp_path, monkeypatch, make_news, row, error):
    monkeypatch.setattr(data, "load_news", lambda: make_news([{"id": "1"}]))
    path = tmp_path / "gold.csv"
    path.write_text(GOLD_HEADER + row)
    with pytest.raises(ValueError, match=error):
        data.load_gold(path)


def test_sample_gold(tmp_path, monkeypatch, make_news):
    rows = [{"id": f"f{i}", "source": "finnhub", "ticker": t} for t in ["AAPL", "MSFT"] for i in range(5)]
    rows += [{"id": "m-in", "published": "2026-11-07"}, {"id": "m-early", "published": "2026-10-01"}]
    monkeypatch.setattr(data, "load_news", lambda: make_news(rows))
    out = data.sample_gold(n_finnhub=3, n_marketaux=2, path=tmp_path / "todo.csv")
    finnhub = out[out["id"].str.startswith("f")]
    assert finnhub["ticker"].value_counts().to_dict() == {"AAPL": 3, "MSFT": 3}
    assert "m-in" in set(out["id"]) and "m-early" not in set(out["id"])
    assert list(out.columns) == ["id", "ticker", "title", "summary", "label", "mixed_signal"]
    assert (tmp_path / "todo.csv").exists()
