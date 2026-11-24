"""The API behind the website in web/: the scored news, the headline analyzer (runs the champion) and the registry.

uv run python -m frontend.server score    # label every article in news.parquet with the champion (cached)
uv run python -m frontend.server prices   # daily closing prices from Yahoo Finance (cached, optional)
uv run python -m frontend.server          # the API on http://localhost:8000 (HOST / PORT in .env change it);
                                          # the site itself runs from web/ (see frontend/UI_SETUP.md)

The server notices on its own when a new champion is promoted or the cached files are rewritten, so it never
needs a restart after `score`, `prices` or a promotion.

Deployed (Dockerfile.api), MODEL_DIR and REGISTRY_FILE point at the champion's files and registry.json baked into the
image, so no MLflow registry is needed; see DEPLOY.md.
"""

import json
import os
import sys
import threading
import time
from functools import lru_cache
from pathlib import Path

import pandas as pd
import uvicorn
import yfinance as yf
from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

from scripts import hardware, registry
from scripts.config import ROOT, TICKER_NAMES
from scripts.data import load_news, model_input
from scripts.evaluate import predict_probs

PRED_PATH = ROOT / "outputs" / "predictions.parquet"
PRICE_PATH = ROOT / "outputs" / "prices.parquet"
LABELS = ["positive", "neutral", "negative"]
NAMES = {"AAPL": "Apple", "MSFT": "Microsoft", "NVDA": "NVIDIA", "GOOGL": "Alphabet",
         "META": "Meta Platforms", "AMZN": "Amazon", "TSLA": "Tesla"}

MAX_CHARS = 500  # longest headline the Analyzer takes; each word costs one extra model pass
MODEL_DIR = os.getenv("MODEL_DIR")  # deployed: the champion's files, loaded without the MLflow registry
REGISTRY_FILE = Path(os.getenv("REGISTRY_FILE") or ROOT / "bundle" / "registry.json")  # deployed: champion + scores

app = FastAPI(title="FinMLOps sentiment")
app.add_middleware(GZipMiddleware, minimum_size=1000)  # the overview JSON shrinks about 5x


def log_json(**fields):
    """one JSON line on stdout: Cloud Logging reads severity and httpRequest from it, and it stays readable locally"""
    print(json.dumps(fields, default=str), flush=True)


@app.middleware("http")
async def access_log(request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        log_json(severity="ERROR" if response.status_code >= 500 else "INFO",
                 message=f"{request.method} {request.url.path} {response.status_code}",
                 httpRequest={"requestMethod": request.method, "requestUrl": str(request.url),
                              "status": response.status_code, "latency": f"{time.perf_counter() - start:.3f}s"})
    return response


_model = {"version": None, "parts": None}
_model_lock = threading.Lock()  # requests run in parallel threads; only one of them may (re)load the model


def champion_version():
    """the champion's version: from the baked registry.json when deployed, else from the MLflow registry"""
    if MODEL_DIR:
        return json.loads(REGISTRY_FILE.read_text())["champion"]
    registry.setup()
    return registry.champion_version()


def champion():
    """the champion (model, tokenizer), reloaded automatically when a new version gets the champion alias"""
    version = champion_version()
    if version is None:
        raise RuntimeError("no champion registered yet")
    with _model_lock:
        if _model["version"] != version:
            _model.update(version=None, parts=None)  # let the old model go before loading the new one
            hardware.free_memory()
            _model.update(version=version, parts=registry.load_dir(MODEL_DIR) if MODEL_DIR else registry.load(version))
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
    probs = predict_probs(model, tokenizer, model_input(df))  # per ticker: "NVDA (NVIDIA): ..."
    df["pred"] = [model.config.id2label[i] for i in probs.argmax(dim=-1).tolist()]
    df["confidence"] = probs.max(dim=-1).values.tolist()
    df["version"] = champion_version()
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
    news()  # 503 if there are no predictions yet
    return build_overview(PRED_PATH.stat().st_mtime_ns, PRICE_PATH.stat().st_mtime_ns if PRICE_PATH.exists() else 0)


@lru_cache(maxsize=1)
def build_overview(news_mtime, price_mtime):
    """computed once per version of the two files, not on every page load"""
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
        df = df[df["title"].str.contains(q, case=False, regex=False)
                | df["publisher"].fillna("").str.contains(q, case=False, regex=False)]
    df = df.sort_values("published", ascending=False).head(limit)
    return [article(r) for r in df.itertuples()]


class Headline(BaseModel):
    text: str
    ticker: str = ""  # optional: score the headline for this company, the way the dashboard does


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
    if body.ticker.upper() in TICKER_NAMES:
        prefix = f"{body.ticker.upper()} ({TICKER_NAMES[body.ticker.upper()]}): "
        texts = [prefix + t for t in texts]
    probs = predict_probs(model, tokenizer, texts)
    labels = [model.config.id2label[i].lower() for i in range(probs.shape[1])]
    score = probs[:, labels.index("positive")] - probs[:, labels.index("negative")]
    label = labels[int(probs[0].argmax())]
    # for monitoring: the label mix of what visitors analyze (the headline itself isn't logged)
    log_json(severity="INFO", message="prediction", event="prediction", version=_model["version"], label=label,
             confidence=round(float(probs[0].max()), 4), words=len(words))
    return {
        "label": label,
        "probs": dict(zip(labels, probs[0].tolist())),
        "words": [{"word": w, "impact": round(float(score[0] - score[i + 1]), 4)} for i, w in enumerate(words)],
    }


@app.get("/api/models")
def models():
    """every registered version with its scores: the baked registry.json when deployed, else the MLflow registry"""
    try:
        if MODEL_DIR:
            return json.loads(REGISTRY_FILE.read_text())["versions"]
        registry.setup()
        return registry.versions()
    except Exception as exc:
        raise HTTPException(503, f"Model registry unavailable ({exc})")


@app.get("/api/health")
def health():
    """for the deploy smoke test and the uptime check: the champion served and how fresh the scored news is"""
    try:
        version = champion_version()
    except Exception as exc:
        raise HTTPException(503, f"No champion model ({exc})")
    as_of = news()["published"].max().isoformat() if PRED_PATH.exists() else None
    return {"status": "ok", "champion": version, "model_loaded": _model["version"] == version, "news_as_of": as_of}


@app.get("/")
def root():
    """this is only the API; anyone who opens it in a browser is pointed at the site"""
    return {"service": "FinMLOps API", "site": "the website runs from web/: cd web && npm run dev, then "
            "http://localhost:3000 (see frontend/UI_SETUP.md)", "health": "/api/health", "docs": "/docs"}


if __name__ == "__main__":
    args = sys.argv[1:]
    if args == ["score"]:
        score_news()
    elif args == ["prices"]:
        fetch_prices()
    elif not args:
        if MODEL_DIR:  # load the model while the container starts, so the first Analyzer request isn't the slow one
            threading.Thread(target=champion, daemon=True).start()
        # access_log=False: access_log() above writes one structured line per API request instead
        uvicorn.run(app, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000")), access_log=False)
    else:
        sys.exit("usage: python -m frontend.server [score | prices]")
