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
LLM_LABELS_PATH = ROOT / "data" / "llm_labels.parquet"  # LLM labels for Finnhub rows (made by scripts.llm_labels)
COLUMNS = ["id", "source", "publisher", "ticker", "title", "summary", "text", "published", "url", "sentiment_score"]
TICKERS = {"AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN", "TSLA"}
TICKER_NAMES = {"AAPL": "Apple", "MSFT": "Microsoft", "NVDA": "NVIDIA", "GOOGL": "Alphabet",
                "META": "Meta Platforms", "AMZN": "Amazon", "TSLA": "Tesla"}
LABELS = ["negative", "neutral", "positive"]
LABEL_THRESHOLD = 0.15  # Marketaux score above +x is positive, below -x negative
THRESHOLDS = [0.10, LABEL_THRESHOLD, 0.25]  # cut-offs we compare, to show how much this choice matters
VAL_FRAC = 0.1  # latest share of the pre-benchmark news used for validation
# frozen benchmark window (see benchmark.py): news in [TEST_START, TEST_END) is never trained on.
# Rows after TEST_END are ignored until we deliberately re-cut the benchmark with new dates.
TEST_START = pd.Timestamp("2026-11-06", tz="UTC")
TEST_END = pd.Timestamp("2026-11-12", tz="UTC")
# gap between training and test: news from the last EMBARGO before TEST_START is used for neither, so a story that
# breaks the day before the test window can't end up on both sides
EMBARGO = pd.Timedelta(hours=24)
# gold set, all from the test window: mostly Finnhub (what users see), plus Marketaux rows so we can measure how often
# Marketaux's score agrees with our hand labels. GOLD_SHARED of the rows get a second annotator, for agreement.
GOLD_FINNHUB_PER_TICKER = 100
GOLD_MARKETAUX_PER_TICKER = 15
GOLD_SHARED = 0.15

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

# LLM labels for the unlabeled Finnhub rows (scripts/llm_labels.py); used for training only if they agree with the
# gold set at least as well as Marketaux's labels do
LLM_MODEL = "gemini-3.5-flash"  # override with LLM_MODEL in .env (2.5 models are closed to new keys)
LLM_BATCH = 25  # headlines per request
USE_LLM_LABELS = True
LLM_MIN_KAPPA = 0.6  # "substantial" agreement; the bar when Marketaux's own agreement can't be measured

# slice analysis (scripts/slices.py): metrics per ticker, source, publisher, length; warn when slices drift apart
MIN_SLICE_ROWS = 20  # smaller slices are too noisy to judge
MAX_SLICE_GAP = 0.15  # accuracy gap between the best and worst slice that triggers a warning
TOP_PUBLISHERS = 5

# tracking
REGISTRY_NAME = "finbert-sentiment"
STUDY = "finbert-lora"
MLFLOW_URI = f"sqlite:///{ROOT / 'mlflow.db'}"  # override with MLFLOW_TRACKING_URI (e.g. a shared server)
STORAGE = f"sqlite:///{ROOT / 'optuna.db'}"  # Optuna study, read again by analysis.py

# promotion
MIN_F1 = 0.6  # a challenger below this macro F1 fails validation
TOLERANCE = 0.02  # a challenger may be this much worse on a ticker (small slices are noisy)
BOOTSTRAP_ROUNDS = 1000  # resamples for the confidence interval on the macro F1 gain
CONFIDENCE = 0.95  # the challenger is promoted only if the lower end of this interval is above zero


def setup_logging():
    """INFO for our scripts, WARNING and up for chatty libraries (HTTP requests, database migrations, MLflow notices)"""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    for name in ["httpx", "urllib3", "huggingface_hub", "filelock", "alembic", "mlflow"]:
        logging.getLogger(name).setLevel(logging.WARNING)
