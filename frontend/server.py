"""Web dashboard: a small FastAPI backend for the frontend in frontend/static.

uv run python -m frontend.server score    # label every article in news.parquet with the champion (cached)
uv run python -m frontend.server prices   # daily closing prices from Yahoo Finance (cached, optional)
uv run python -m frontend.server          # then open http://localhost:8000 (HOST / PORT in .env change it)

The server notices on its own when a new champion is promoted or the cached files are rewritten, so it never
needs a restart after `score`, `prices` or a promotion.
"""

import os
import sys
import threading
from functools import lru_cache
from pathlib import Path

import pandas as pd
import uvicorn
import yfinance as yf
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from mlflow import MlflowClient
from pydantic import BaseModel

from scripts import hardware, registry
from scripts.config import ROOT
from scripts.data import load_news
from scripts.evaluate import predict_probs

STATIC = Path(__file__).parent / "static"
PRED_PATH = ROOT / "outputs" / "predictions.parquet"
PRICE_PATH = ROOT / "outputs" / "prices.parquet"
LABELS = ["positive", "neutral", "negative"]
NAMES = {"AAPL": "Apple", "MSFT": "Microsoft", "NVDA": "NVIDIA", "GOOGL": "Alphabet",
         "META": "Meta Platforms", "AMZN": "Amazon", "TSLA": "Tesla"}

MAX_CHARS = 500  # longest headline the Analyzer takes; each word costs one extra model pass

app = FastAPI(title="FinMLOps sentiment")
_model = {"version": None, "parts": None}
_model_lock = threading.Lock()  # requests run in parallel threads; only one of them may (re)load the model


def champion():
    """the champion (model, tokenizer), reloaded automatically when a new version gets the champion alias"""
    registry.setup()
    version = registry.champion_version()
    if version is None:
        raise RuntimeError("no champion registered yet")
    with _model_lock:
        if _model["version"] != version:
            _model.update(version=None, parts=None)  # let the old model go before loading the new one
            hardware.free_memory()
            _model.update(version=version, parts=registry.load(version))
        return _model["parts"]


def save_parquet(df, path):
    """write in one step, so the running server never reads a half-written file"""
    path.parent.mkdir(exist_ok=True)
    tmp = path.with_suffix(".tmp")
    df.to_parquet(tmp, index=False)
    tmp.replace(path)


def score_news():
    """label every article with the champion and cache it, so the dashboard never runs the model per page load"""
    model, tokenizer = champion()
    df = load_news()
    probs = predict_probs(model, tokenizer, df["text"].tolist())
    df["pred"] = [model.config.id2label[i] for i in probs.argmax(dim=-1).tolist()]
    df["confidence"] = probs.max(dim=-1).values.tolist()
    df["version"] = registry.champion_version()
    save_parquet(df, PRED_PATH)
    print(f"scored {len(df)} articles -> {PRED_PATH}")


def fetch_prices():
    """daily closes for the news period from Yahoo Finance (yfinance is unofficial, so we cache the result)"""
    start = load_news()["published"].min().strftime("%Y-%m-%d")
    close = yf.download(list(NAMES), start=start, auto_adjust=True, progress=False)["Close"]
    df = close.reset_index().melt(id_vars="Date", var_name="ticker", value_name="close").dropna()
    df["date"] = df["Date"].dt.strftime("%Y-%m-%d")
    save_parquet(df[["ticker", "date", "close"]], PRICE_PATH)
    print(f"saved {len(df)} daily closes -> {PRICE_PATH}")


def prices():
    """{ticker: {date: close}}; empty if prices were never fetched (the chart then just hides the price line)"""
    if not PRICE_PATH.exists():
        return {}
    return read_prices(PRICE_PATH.stat().st_mtime_ns)


def news():
    if not PRED_PATH.exists():
        raise HTTPException(503, "No predictions yet. Run: uv run python -m frontend.server score")
    return read_news(PRED_PATH.stat().st_mtime_ns)


# cached by the file's modification time: a rewritten file is read again on the next request, without a restart
@lru_cache(maxsize=1)
def read_prices(mtime):
    df = pd.read_parquet(PRICE_PATH)
    return {t: dict(zip(g["date"], g["close"].round(2))) for t, g in df.groupby("ticker")}


@lru_cache(maxsize=1)
def read_news(mtime):
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


class Headline(BaseModel):
    text: str


@app.post("/api/predict")
def analyze(body: Headline):
    """label + probabilities, and each word's influence: how much positive-minus-negative drops without it"""
    if len(body.text) > MAX_CHARS:
        raise HTTPException(422, f"That's {len(body.text)} characters; the Analyzer takes headlines up to {MAX_CHARS}.")
    words = body.text.split()
    if not words:
        raise HTTPException(400, "Type a headline first.")
    try:
        model, tokenizer = champion()
    except Exception as exc:
        raise HTTPException(503, f"No champion model in the registry yet ({exc})")
    texts = [" ".join(words)] + [" ".join(words[:i] + words[i + 1:]) for i in range(len(words))]
    probs = predict_probs(model, tokenizer, texts)
    labels = [model.config.id2label[i].lower() for i in range(probs.shape[1])]
    score = probs[:, labels.index("positive")] - probs[:, labels.index("negative")]
    return {
        "label": labels[int(probs[0].argmax())],
        "probs": dict(zip(labels, probs[0].tolist())),
        "words": [{"word": w, "impact": round(float(score[0] - score[i + 1]), 4)} for i, w in enumerate(words)],
    }


@app.get("/api/models")
def models():
    """every registered version with the metrics its run logged (test_* for LoRA runs, plain for the baseline)"""
    try:
        registry.setup()
        client = MlflowClient()
        champ = registry.champion_version()
        out = []
        for v in client.search_model_versions(f"name='{registry.NAME}'"):
            run = client.get_run(v.run_id)
            m = run.data.metrics
            p = "test_" if "test_f1_macro" in m else ""
            out.append({
                "version": int(v.version),
                "run": run.info.run_name,
                "created": v.creation_timestamp,
                "champion": v.version == champ,
                "f1_macro": m.get(f"{p}f1_macro"),
                "accuracy": m.get(f"{p}accuracy"),
                "per_ticker": {t: m.get(f"{p}accuracy_{t}") for t in NAMES},
            })
    except Exception as exc:
        raise HTTPException(503, f"Model registry unavailable ({exc})")
    return sorted(out, key=lambda r: -r["version"])


@app.get("/api/health")
def health():
    """what the dashboard has to work with; 503 when it can't show anything (no predictions), 200 otherwise"""
    try:
        registry.setup()
        champ, registry_ok = registry.champion_version(), True
    except Exception:
        champ, registry_ok = None, False
    scored_by = str(news()["version"].iloc[0]) if PRED_PATH.exists() else None
    out = {
        "status": "ok" if scored_by and champ else "degraded" if scored_by else "down",
        "predictions": PRED_PATH.exists(),
        "predictions_scored_by": scored_by,
        "predictions_outdated": bool(scored_by and champ and scored_by != str(champ)),  # rerun `score`
        "prices": PRICE_PATH.exists(),
        "registry": registry_ok,
        "champion": champ,
        "model_loaded": _model["version"],
    }
    return JSONResponse(out, status_code=200 if scored_by else 503)


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args == ["score"]:
        score_news()
    elif args == ["prices"]:
        fetch_prices()
    elif not args:
        uvicorn.run(app, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000")))
    else:
        sys.exit("usage: python -m frontend.server [score | prices]")
