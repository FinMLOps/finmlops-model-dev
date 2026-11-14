"""Web dashboard: a small FastAPI backend for the frontend in frontend/static.

uv run python -m frontend.server score    # label every article in news.parquet with the champion (cached)
uv run python -m frontend.server prices   # daily closing prices from Yahoo Finance (cached, optional)
uv run python -m frontend.server          # then open http://localhost:8000
"""

import sys
from functools import lru_cache
from pathlib import Path

import pandas as pd
import uvicorn
import yfinance as yf
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from scripts import registry
from scripts.config import ROOT
from scripts.data import load_news
from scripts.evaluate import predict_probs

STATIC = Path(__file__).parent / "static"
PRED_PATH = ROOT / "outputs" / "predictions.parquet"
PRICE_PATH = ROOT / "outputs" / "prices.parquet"
LABELS = ["positive", "neutral", "negative"]
NAMES = {"AAPL": "Apple", "MSFT": "Microsoft", "NVDA": "NVIDIA", "GOOGL": "Alphabet",
         "META": "Meta Platforms", "AMZN": "Amazon", "TSLA": "Tesla"}

app = FastAPI(title="FinMLOps sentiment")


@lru_cache
def champion():
    registry.setup()
    return registry.load()


def score_news():
    """label every article with the champion and cache it, so the dashboard never runs the model per page load"""
    model, tokenizer = champion()
    df = load_news()
    probs = predict_probs(model, tokenizer, df["text"].tolist())
    df["pred"] = [model.config.id2label[i] for i in probs.argmax(dim=-1).tolist()]
    df["confidence"] = probs.max(dim=-1).values.tolist()
    df["version"] = registry.champion_version()
    PRED_PATH.parent.mkdir(exist_ok=True)
    df.to_parquet(PRED_PATH, index=False)
    print(f"scored {len(df)} articles -> {PRED_PATH}")


def fetch_prices():
    """daily closes for the news period from Yahoo Finance (yfinance is unofficial, so we cache the result)"""
    start = load_news()["published"].min().strftime("%Y-%m-%d")
    close = yf.download(list(NAMES), start=start, auto_adjust=True, progress=False)["Close"]
    df = close.reset_index().melt(id_vars="Date", var_name="ticker", value_name="close").dropna()
    df["date"] = df["Date"].dt.strftime("%Y-%m-%d")
    PRICE_PATH.parent.mkdir(exist_ok=True)
    df[["ticker", "date", "close"]].to_parquet(PRICE_PATH, index=False)
    print(f"saved {len(df)} daily closes -> {PRICE_PATH}")


@lru_cache
def prices():
    """{ticker: {date: close}}; empty if prices were never fetched (the chart then just hides the price line)"""
    if not PRICE_PATH.exists():
        return {}
    df = pd.read_parquet(PRICE_PATH)
    return {t: dict(zip(g["date"], g["close"].round(2))) for t, g in df.groupby("ticker")}


@lru_cache
def news():
    if not PRED_PATH.exists():
        raise HTTPException(503, "No predictions yet. Run: uv run python -m frontend.server score")
    df = pd.read_parquet(PRED_PATH)
    df["date"] = df["published"].dt.strftime("%Y-%m-%d")
    return df


def text(value):
    return value if isinstance(value, str) else ""


def counts(pos, neu, neg):
    """net sentiment = % positive minus % negative, from -100 to 100"""
    n = pos + neu + neg
    return {"articles": n, "positive": pos, "neutral": neu, "negative": neg,
            "net": round(100 * (pos - neg) / n, 1) if n else 0.0}


def summary(df):
    c = df["pred"].value_counts()
    return counts(*(int(c.get(label, 0)) for label in LABELS))


def article(r):
    """one headline as JSON (r is a row from df.itertuples())"""
    return {"id": r.id, "ticker": r.ticker, "title": r.title, "summary": text(r.summary), "text": r.text,
            "publisher": text(r.publisher), "url": text(r.url), "published": r.published.isoformat(),
            "pred": r.pred, "confidence": float(r.confidence)}


def top_per_day(df, label):
    """{date: the most confident headline with this label that day}"""
    best = df[df["pred"] == label].sort_values("confidence", ascending=False).drop_duplicates("date")
    return {r.date: article(r) for r in best.itertuples()}


def daily(df, closes):
    """one row per day: label counts, net sentiment, closing price (None on weekends) and that day's top headlines"""
    table = pd.crosstab(df["date"], df["pred"]).reindex(columns=LABELS, fill_value=0)
    pos, neg = top_per_day(df, "positive"), top_per_day(df, "negative")
    return [{"date": d, **counts(*map(int, row)), "close": closes.get(d),
             "top_positive": pos.get(d), "top_negative": neg.get(d)} for d, row in table.iterrows()]


@app.get("/api/overview")
def overview():
    """per ticker: last 7 days, the 7 days before, and the daily series"""
    df = news()
    end = df["published"].max()
    week_ago, two_weeks_ago = end - pd.Timedelta(days=7), end - pd.Timedelta(days=14)
    tickers = []
    for ticker, name in NAMES.items():
        t = df[df["ticker"] == ticker]
        tickers.append({
            "ticker": ticker,
            "name": name,
            "week": summary(t[t["published"] > week_ago]),
            "prev": summary(t[(t["published"] > two_weeks_ago) & (t["published"] <= week_ago)]),
            "daily": daily(t, prices().get(ticker, {})),
            "latest_at": t["published"].max().isoformat(),
        })
    return {"as_of": end.isoformat(), "scored_by": str(df["version"].iloc[0]), "tickers": tickers}


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")


if __name__ == "__main__":
    if sys.argv[1:] == ["score"]:
        score_news()
    elif sys.argv[1:] == ["prices"]:
        fetch_prices()
    else:
        uvicorn.run(app, port=8000)
