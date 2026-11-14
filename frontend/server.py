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
    try:
        import yfinance as yf
    except ImportError:
        raise RuntimeError("yfinance is required for price fetching. Run: uv add yfinance")
    start = load_news()["published"].min().strftime("%Y-%m-%d")
    close = yf.download(list(NAMES), start=start, auto_adjust=True, progress=False)["Close"]
    df = close.reset_index().melt(id_vars="Date", var_name="ticker", value_name="close").dropna()
    df["date"] = df["Date"].dt.strftime("%Y-%m-%d")
    PRICE_PATH.parent.mkdir(exist_ok=True)
    df[["ticker", "date", "close"]].to_parquet(PRICE_PATH, index=False)
    print(f"saved {len(df)} daily closes -> {PRICE_PATH}")


def generate_mock_prices(df=None):
    """generate synthetic daily close prices for tickers so charts can display prices"""
    import numpy as np
    base_prices = {"AAPL": 225.0, "MSFT": 420.0, "NVDA": 145.0, "GOOGL": 180.0,
                   "META": 585.0, "AMZN": 205.0, "TSLA": 310.0}
    if df is not None and "published" in df.columns:
        start_d = df["published"].min().date()
        end_d = df["published"].max().date()
        dates = pd.date_range(start_d, end_d, freq="D")
    else:
        dates = pd.date_range((pd.Timestamp.now() - pd.Timedelta(days=30)).date(), pd.Timestamp.now().date(), freq="D")

    rows = []
    np.random.seed(42)
    for ticker, base in base_prices.items():
        price = base
        for d in dates:
            if d.weekday() >= 5:  # skip weekends
                continue
            ret = float(np.random.normal(0.0008, 0.015))
            price = round(price * (1 + ret), 2)
            rows.append({"ticker": ticker, "date": d.strftime("%Y-%m-%d"), "close": price})

    price_df = pd.DataFrame(rows)
    PRICE_PATH.parent.mkdir(exist_ok=True)
    price_df.to_parquet(PRICE_PATH, index=False)
    print(f"saved mock prices ({len(price_df)} daily closes) -> {PRICE_PATH}")


def generate_mock_data():
    """generate realistic mock predictions from data/news.parquet or synthetic data for previewing UI"""
    import numpy as np
    PRED_PATH.parent.mkdir(exist_ok=True)
    try:
        df = load_news()
    except Exception:
        df = None

    if df is not None and not df.empty:
        np.random.seed(42)
        preds = []
        confs = []
        for s in df["sentiment_score"]:
            if pd.notna(s):
                if s > 0.15:
                    p = "positive"
                    c = min(0.99, 0.70 + float(abs(s)) * 0.28)
                elif s < -0.15:
                    p = "negative"
                    c = min(0.99, 0.70 + float(abs(s)) * 0.28)
                else:
                    p = "neutral"
                    c = 0.75 + float(np.random.uniform(0.0, 0.20))
            else:
                p = str(np.random.choice(["positive", "neutral", "negative"], p=[0.35, 0.45, 0.20]))
                c = float(np.random.uniform(0.68, 0.96))
            preds.append(p)
            confs.append(round(c, 4))
        df["pred"] = preds
        df["confidence"] = confs
        df["version"] = "mock-baseline"
    else:
        now = pd.Timestamp.now(tz="UTC")
        rows = []
        publishers = ["Bloomberg", "Reuters", "CNBC", "Financial Times", "Wall Street Journal"]
        templates = [
            ("{name} reports record revenue driven by enterprise AI adoption", "positive", 0.92),
            ("Wall Street analysts raise price target for {ticker}", "positive", 0.88),
            ("{name} expands cloud infrastructure partnerships across Europe", "positive", 0.85),
            ("Regulatory concerns loom over {name} ahead of antitrust hearing", "negative", 0.84),
            ("{ticker} slides following supply chain delay reports", "negative", 0.79),
            ("Tech selloff pressures {ticker} and broader NASDAQ composite", "negative", 0.82),
            ("{name} announces upcoming annual developer conference schedule", "neutral", 0.89),
            ("Investors weigh macroeconomic factors impacting {ticker}", "neutral", 0.74),
            ("{name} CEO discusses long-term capital allocation strategy", "neutral", 0.81),
            ("{ticker} trading volume surges in afternoon market session", "neutral", 0.76),
        ]
        row_id = 1
        np.random.seed(42)
        for ticker, name in NAMES.items():
            for day_offset in range(21):
                day = now - pd.Timedelta(days=day_offset)
                n_articles = int(np.random.randint(4, 9))
                for _ in range(n_articles):
                    tmpl, sentiment, conf_base = templates[int(np.random.randint(0, len(templates)))]
                    title = tmpl.format(ticker=ticker, name=name)
                    pub_time = day - pd.Timedelta(hours=int(np.random.randint(1, 23)), minutes=int(np.random.randint(0, 59)))
                    conf = min(0.99, max(0.60, conf_base + float(np.random.uniform(-0.1, 0.07))))
                    rows.append({
                        "id": row_id,
                        "source": "mock",
                        "publisher": publishers[int(np.random.randint(0, len(publishers)))],
                        "ticker": ticker,
                        "title": title,
                        "summary": f"Latest updates and market analysis for {name} ({ticker}).",
                        "text": f"{title}. Full coverage and detailed commentary on {name} market movement.",
                        "published": pub_time,
                        "url": f"https://finance.example.com/news/{row_id}",
                        "sentiment_score": 0.5 if sentiment == "positive" else (-0.5 if sentiment == "negative" else 0.0),
                        "pred": sentiment,
                        "confidence": round(conf, 4),
                        "version": "mock-baseline",
                    })
                    row_id += 1
        df = pd.DataFrame(rows)

    df.to_parquet(PRED_PATH, index=False)
    print(f"saved mock predictions ({len(df)} articles) -> {PRED_PATH}")
    generate_mock_prices(df)


@lru_cache
def prices():
    """{ticker: {date: close}}; empty if prices were never fetched (the chart then just hides the price line)"""
    if not PRICE_PATH.exists():
        generate_mock_prices()
    if not PRICE_PATH.exists():
        return {}
    df = pd.read_parquet(PRICE_PATH)
    return {t: dict(zip(g["date"], g["close"].round(2))) for t, g in df.groupby("ticker")}


@lru_cache
def news():
    if not PRED_PATH.exists():
        generate_mock_data()
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
            "latest_at": t["published"].max().isoformat() if not t.empty else end.isoformat(),
        })
    return {"as_of": end.isoformat(), "scored_by": str(df["version"].iloc[0]), "tickers": tickers}


@app.get("/api/headlines")
def headlines(ticker: str = "", label: str = "", q: str = "", limit: int = 50):
    df = news()
    if ticker:
        df = df[df["ticker"] == ticker]
    if label:
        df = df[df["pred"] == label]
    if q:
        df = df[df["title"].str.contains(q, case=False, regex=False)]
    df = df.sort_values("published", ascending=False).head(limit)
    return [article(r) for r in df.itertuples()]


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")


if __name__ == "__main__":
    if sys.argv[1:] == ["score"]:
        score_news()
    elif sys.argv[1:] == ["prices"]:
        fetch_prices()
    elif sys.argv[1:] == ["mock"]:
        generate_mock_data()
    else:
        if not PRED_PATH.exists():
            print("No predictions cache found. Generating dummy data for UI preview...")
            generate_mock_data()
        uvicorn.run(app, port=8000)
