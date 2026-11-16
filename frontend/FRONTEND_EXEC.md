# Running the dashboard with real data

## Requirements

- `uv` and the Google Cloud CLI (`brew install uv`, `brew install --cask google-cloud-sdk`)
- Access to the `finmlops-pipeline-dvc` bucket

## First time

```bash
git clone https://github.com/FinMLOps/finmlops-model-dev.git
cd finmlops-model-dev
uv sync --extra cpu                          # or --extra gpu on an NVIDIA machine
gcloud auth application-default login
uv run dvc pull                              # data/news.parquet
uv run python -m scripts.train baseline      # registers pretrained FinBERT as the champion (skip if you already have one)
```

## Run

```bash
uv run python -m frontend.server score       # label every article with the champion -> outputs/predictions.parquet
uv run python -m frontend.server prices      # daily closes from Yahoo Finance -> outputs/prices.parquet (optional)
uv run python -m frontend.server             # http://localhost:8000
```

Stop the server with Ctrl+C. Change the address with `HOST` and `PORT` in `.env`.

## Get newer news

```bash
uv run dvc update data/news.parquet.dvc      # latest data pipeline snapshot
uv run python -m frontend.server score
uv run python -m frontend.server prices
```

The running server picks up the new files without a restart.
Commit `data/news.parquet.dvc` only through a PR: a change to it on `main` starts the training workflow.

## Notes

- The dashboard shows the champion's labels. After a new champion is promoted, run `score` again.
- `score` takes about 2 minutes on an Apple M4 Pro for about 24,000 articles.
- Prices exist only for trading days, so weekends and holidays have no price.
- `frontend/demo_server.py` shows fake data, for UI work only (see `UI_SETUP.md`).

## Problems

| Error | Fix |
|---|---|
| `news.parquet not found` | `uv run dvc pull` |
| `no champion registered yet` | `uv run python -m scripts.train baseline` |
| `No predictions yet` in the browser | `uv run python -m frontend.server score` |
| `dvc pull` hangs or is denied | `gcloud auth application-default login`, and ask for bucket access |
| Port 8000 in use | set `PORT=8001` in `.env` |
