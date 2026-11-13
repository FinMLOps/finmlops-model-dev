"""Shared fixtures: tiny fake news tables, so no test needs the real news.parquet."""

import pandas as pd
import pytest

ROW = {"id": "a", "source": "marketaux", "publisher": "p", "ticker": "AAPL", "title": "t", "summary": "s",
       "text": "t s", "published": "2026-11-01", "url": "u", "sentiment_score": 0.5}


@pytest.fixture
def make_news():
    """make_news([{...}, ...]) -> news.parquet-shaped DataFrame; each dict overrides the default row"""
    def make(rows):
        df = pd.DataFrame([{**ROW, **r} for r in rows])
        df["published"] = pd.to_datetime(df["published"], utc=True)
        return df
    return make
