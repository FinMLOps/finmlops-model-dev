"""All settings in one place; the other scripts import from here."""

import logging
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "outputs"

# optional settings from .env (email, MLflow server, GCS bucket, TORCH_DEVICE); values already set in the shell win
load_dotenv(ROOT / ".env")

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
BASE_REVISION = "0bc2ac10dda6929bcb1f77ccc43c7ec5c424f031"  # pinned Hugging Face commit, so the baseline can't change
MAX_LENGTH = 256
SEED = 0
DEFAULTS = {"lr": 2e-4, "r": 8, "alpha": 16, "dropout": 0.1, "epochs": 3, "batch_size": 16}
WEIGHT_DECAY = 0.01
WARMUP_FRAC = 0.1  # share of the training steps in which the learning rate ramps up from 0
MAX_GRAD_NORM = 1.0  # gradient clipping, so one bad batch can't throw the weights off
MIXED_PRECISION = True  # bf16 / fp16 training on NVIDIA GPUs only; Apple Silicon and CPU always train in fp32
EVAL_BATCH_SIZE = 32
N_TRIALS = 10  # Optuna trials per `tune`
SHAP_ROWS = 100  # headlines SHAP explains in analysis.py (slow without a GPU)

# tracking
REGISTRY_NAME = "finbert-sentiment"
STUDY = "finbert-lora"
MLFLOW_URI = f"sqlite:///{ROOT / 'mlflow.db'}"  # override with MLFLOW_TRACKING_URI (e.g. a shared server)
STORAGE = f"sqlite:///{ROOT / 'optuna.db'}"  # Optuna study, read again by analysis.py

# promotion
MIN_F1 = 0.6  # a challenger below this macro F1 fails validation
TOLERANCE = 0.02  # a challenger may be this much worse on a ticker (small slices are noisy)


def setup_logging():
    """INFO for our scripts, WARNING and up for chatty libraries (HTTP requests, database migrations, MLflow notices)"""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    for name in ["httpx", "urllib3", "huggingface_hub", "filelock", "alembic", "mlflow"]:
        logging.getLogger(name).setLevel(logging.WARNING)
