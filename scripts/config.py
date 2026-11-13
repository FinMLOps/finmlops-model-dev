"""All settings in one place; the other scripts import from here."""

from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "outputs"

# data
DATA_PATH = ROOT / "data" / "news.parquet"
GOLD_PATH = ROOT / "data" / "gold.csv"  # hand labels; the set that decides promotion once it exists
GOLD_TODO_PATH = ROOT / "data" / "gold_todo.csv"  # rows waiting to be hand-labeled (made by `scripts.data sample-gold`)
COLUMNS = ["id", "source", "publisher", "ticker", "title", "summary", "text", "published", "url", "sentiment_score"]
TICKERS = {"AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN", "TSLA"}
LABELS = ["negative", "neutral", "positive"]
LABEL_THRESHOLD = 0.15  # Marketaux score above +x is positive, below -x negative
THRESHOLDS = [0.10, LABEL_THRESHOLD, 0.25]  # cut-offs we compare, to show how much this choice matters
VAL_FRAC = 0.1  # latest share of the pre-benchmark news used for validation
# frozen benchmark window (see benchmark.py): news in [TEST_START, TEST_END) is never trained on.
# Rows after TEST_END are ignored until we deliberately re-cut the benchmark with new dates.
TEST_START = pd.Timestamp("2026-11-06", tz="UTC")
TEST_END = pd.Timestamp("2026-11-12", tz="UTC")
# gold set: Finnhub rows per ticker (never trained on), plus Marketaux benchmark rows per ticker
# so we can measure how often Marketaux's score agrees with our hand labels
GOLD_FINNHUB_PER_TICKER = 100
GOLD_MARKETAUX_PER_TICKER = 15

# model and training
BASE = "ProsusAI/finbert"
MAX_LENGTH = 256
SEED = 0
DEFAULTS = {"lr": 2e-4, "r": 8, "alpha": 16, "dropout": 0.1, "epochs": 3, "batch_size": 16}

# tracking
REGISTRY_NAME = "finbert-sentiment"
STUDY = "finbert-lora"
MLFLOW_URI = f"sqlite:///{ROOT / 'mlflow.db'}"  # override with MLFLOW_TRACKING_URI (e.g. a shared server)
STORAGE = f"sqlite:///{ROOT / 'optuna.db'}"  # Optuna study, read again by analysis.py

# promotion
MIN_F1 = 0.6  # a challenger below this macro F1 fails validation
TOLERANCE = 0.02  # a challenger may be this much worse on a ticker (small slices are noisy)
