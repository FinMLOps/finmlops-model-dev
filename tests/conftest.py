"""Shared fixtures: tiny fake news tables, so no test needs the real news.parquet."""

import pandas as pd
import pytest

ROW = {"id": "a", "source": "marketaux", "publisher": "p", "ticker": "AAPL", "title": "t", "summary": "s",
       "text": "t s", "published": "2026-11-01", "url": "u", "sentiment_score": 0.5}
SETTINGS = ["MLFLOW_TRACKING_URI", "MODEL_BUCKET", "GMAIL_USERNAME", "GMAIL_APP_PASSWORD", "ALERT_RECIPIENTS"]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    """tests never see a developer's .env settings (email, MLflow server, bucket) and always run on the CPU"""
    for key in SETTINGS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("TORCH_DEVICE", "cpu")


@pytest.fixture(autouse=True)
def experiments_off(monkeypatch):
    """the GOLD_SPLIT and CLASS_WEIGHTS settings are read when config.py is imported, so a developer's .env could turn
    them on; tests always start from the defaults and switch them on themselves"""
    from scripts import benchmark, data, train
    for module in (data, benchmark, train):
        monkeypatch.setattr(module, "GOLD_SPLIT", None)
    for module in (data, train):
        monkeypatch.setattr(module, "GOLD_SPLIT_MARKETAUX", False)
        monkeypatch.setattr(module, "CLASS_WEIGHTS", True)


@pytest.fixture
def make_news():
    """make_news([{...}, ...]) -> news.parquet-shaped DataFrame; each dict overrides the default row"""
    def make(rows):
        df = pd.DataFrame([{**ROW, **r} for r in rows])
        df["published"] = pd.to_datetime(df["published"], utc=True, format="ISO8601")
        return df
    return make
