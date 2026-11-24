#!/usr/bin/env bash
# Gets everything the API image bakes in (see Dockerfile.api):
#   1. the news snapshot pinned in data/news.parquet.dvc
#   2. the champion named in the model registry, gs://$MODEL_BUCKET/models/finbert-sentiment/registry.json -> bundle/
#   3. the news scored by that champion, and daily closing prices -> outputs/
# Needs read access to the DVC bucket and MODEL_BUCKET (set in the shell or in .env).
#   deploy/bundle.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> news snapshot (DVC)"
uv run dvc pull data/news.parquet.dvc

echo "==> champion from the model registry"
uv run python -m scripts.deploy pull

echo "==> scoring the news with it (CPU: this takes a while)"
export MODEL_DIR="$PWD/bundle/model" REGISTRY_FILE="$PWD/bundle/registry.json"
uv run python -m frontend.server score
uv run python -m frontend.server prices \
  || echo "warning: couldn't get prices from Yahoo Finance; the dashboard hides the price line"
