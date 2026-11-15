"""TEMPORARY: preview the dashboard with FAKE data (no model, no installs). For UI work only; see frontend/UI_SETUP.md.

Every headline, score, price and model number it shows is made up. The real server is frontend/server.py.

python3 frontend/demo_server.py          -> http://localhost:8001 (PORT=8002 for another port)
DELAY=2 python3 frontend/demo_server.py  -> every API answer waits 2 s (to see the loading skeletons)
"""

import json
import os
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

STATIC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
NAMES = {"AAPL": "Apple", "MSFT": "Microsoft", "NVDA": "NVIDIA", "GOOGL": "Alphabet",
         "META": "Meta Platforms", "AMZN": "Amazon", "TSLA": "Tesla"}
BIAS = {"AAPL": 0.05, "MSFT": 0.15, "NVDA": 0.25, "GOOGL": 0.1, "META": 0.0, "AMZN": 0.08, "TSLA": -0.12}
END = datetime(2026, 11, 7, 12, 50, tzinfo=timezone.utc)
TEMPLATES = {
    "positive": ["{n} beats quarterly revenue estimates", "{n} shares jump after strong guidance",
                 "Analysts raise {n} price target on AI demand", "{n} wins major cloud contract"],
    "neutral": ["{n} to hold annual shareholder meeting", "{n} names new head of operations",
                "What to watch from {n} this week", "{n} files quarterly report with the SEC"],
    "negative": ["{n} shares slide as growth slows", "{n} faces new antitrust probe in Europe",
                 "{n} cuts outlook on weaker demand", "{n} recalls products over safety issue"],
}
PUBLISHERS = ["Reuters", "Yahoo", "MarketWatch", "CNBC", "Benzinga", "SeekingAlpha"]
POS_WORDS = {"beats", "jump", "strong", "raise", "wins", "surge", "grows", "record", "up"}
NEG_WORDS = {"slide", "slows", "probe", "cuts", "weaker", "recalls", "misses", "defect", "down", "but"}


SUMMARIES = {
    "positive": "The company said demand stayed strong across its main segments, and analysts called the results a clear beat.",
    "neutral": "The company shared the update in a regulatory filing. It did not change its outlook for the year.",
    "negative": "The company warned that growth slows into next quarter, and shares fell in early trading.",
}


def make_article(rng, t, lab, published):
    title = rng.choice(TEMPLATES[lab]).format(n=NAMES[t])
    summary = SUMMARIES[lab]
    return {"id": f"{rng.getrandbits(48):012x}", "ticker": t, "title": title, "summary": summary,
            "text": f"{title}\n\n{summary}", "publisher": rng.choice(PUBLISHERS), "url": "https://example.com",
            "published": published.isoformat(), "pred": lab, "confidence": rng.uniform(0.55, 0.99)}


SUMMARIES = {
    "positive": "The company said demand stayed strong across its main segments, and analysts called the results a clear beat.",
    "neutral": "The company shared the update in a regulatory filing. It did not change its outlook for the year.",
    "negative": "The company warned that growth slows into next quarter, and shares fell in early trading.",
}


def make_article(rng, t, lab, published):
    title = rng.choice(TEMPLATES[lab]).format(n=NAMES[t])
    summary = SUMMARIES[lab]
    return {"id": f"{rng.getrandbits(48):012x}", "ticker": t, "title": title, "summary": summary,
            "text": f"{title}\n\n{summary}", "publisher": rng.choice(PUBLISHERS), "url": "https://example.com",
            "published": published.isoformat(), "pred": lab, "confidence": rng.uniform(0.55, 0.99)}


def counts(pos, neu, neg):
    n = pos + neu + neg
    return {"articles": n, "positive": pos, "neutral": neu, "negative": neg,
            "net": round(100 * (pos - neg) / n, 1) if n else 0.0}


def overview():
    rng = random.Random(7)
    tickers = []
    start_price = {"AAPL": 232, "MSFT": 428, "NVDA": 141, "GOOGL": 172, "META": 581, "AMZN": 203, "TSLA": 251}
    for t, name in NAMES.items():
        days, price = [], start_price[t]
        for i in range(38, -1, -1):
            d = END - timedelta(days=i)
            n = rng.randint(40, 140)
            p_pos = min(0.8, max(0.1, 0.38 + BIAS[t] + rng.uniform(-0.15, 0.15) + 0.004 * (38 - i) * (1 if BIAS[t] > 0 else -1)))
            p_neg = max(0.05, min(0.6, 0.22 - BIAS[t] / 2 + rng.uniform(-0.08, 0.08)))
            pos, neg = int(n * p_pos), int(n * p_neg)
            row = counts(pos, n - pos - neg, neg)
            close = None
            if d.weekday() < 5:  # markets closed on weekends
                price *= 1 + 0.003 * row["net"] / 50 + rng.gauss(0, 0.014)
                close = round(price, 2)
            top = {f"top_{lab}": {**make_article(rng, t, lab, d), "confidence": rng.uniform(0.9, 0.99)}
                   for lab in ("positive", "negative")}
            days.append({"date": d.strftime("%Y-%m-%d"), **row, "close": close, **top})
        def total(rows):
            return counts(*(sum(r[k] for r in rows) for k in ("positive", "neutral", "negative")))
        tickers.append({"ticker": t, "name": name, "week": total(days[-7:]), "prev": total(days[-14:-7]),
                        "daily": days, "latest_at": (END - timedelta(minutes=rng.randint(5, 300))).isoformat()})
    return {"as_of": END.isoformat(), "scored_by": "demo", "tickers": tickers}


def headlines(ticker, label, limit):
    rng = random.Random(f"{ticker}{label}")
    rows, t0 = [], datetime.now(timezone.utc)
    for i in range(limit):
        t = ticker or rng.choice(list(NAMES))
        lab = label or rng.choices(["positive", "neutral", "negative"], [0.45, 0.35, 0.2])[0]
        rows.append(make_article(rng, t, lab, t0 - timedelta(minutes=17 * i + rng.randint(0, 15))))
    return rows


def predict(text):
    words = text.split()
    impact = [0.25 if w.lower().strip(".,%") in POS_WORDS else -0.25 if w.lower().strip(".,%") in NEG_WORDS
              else random.uniform(-0.02, 0.02) for w in words]
    s = sum(impact)
    pos, neg = max(0.03, min(0.9, 0.3 + s)), max(0.03, min(0.9, 0.3 - s))
    neu = max(0.04, 1 - pos - neg)
    total = pos + neu + neg
    probs = {"positive": pos / total, "neutral": neu / total, "negative": neg / total}
    return {"label": max(probs, key=probs.get), "probs": probs,
            "words": [{"word": w, "impact": round(x, 4)} for w, x in zip(words, impact)]}


def models():
    now = int(datetime.now().timestamp() * 1000)
    def v(n, run, f1, champ, days):
        rng = random.Random(n)
        return {"version": n, "run": run, "created": now - days * 864e5, "champion": champ, "f1_macro": f1,
                "accuracy": f1 + 0.06, "per_ticker": {t: round(f1 + rng.uniform(-0.08, 0.1), 3) for t in NAMES}}
    return [v(3, "lora", 0.684, False, 0.2), v(2, "lora", 0.712, True, 2), v(1, "baseline", 0.641, False, 5)]


class Handler(SimpleHTTPRequestHandler):
    def send_json(self, data):
        time.sleep(float(os.environ.get("DELAY", 0)))
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path == "/api/overview":
            return self.send_json(overview())
        if url.path == "/api/headlines":
            return self.send_json(headlines(q.get("ticker", ""), q.get("label", ""), int(q.get("limit", 50))))
        if url.path == "/api/models":
            return self.send_json(models())
        return super().do_GET()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.send_json(predict(body["text"]))


PORT = int(os.environ.get("PORT", 8001))
print(f"demo dashboard with FAKE data on http://localhost:{PORT}  (Ctrl+C to stop)")
ThreadingHTTPServer(("127.0.0.1", PORT), partial(Handler, directory=STATIC)).serve_forever()
