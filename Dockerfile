# The model pipeline in a container: same Python and locked packages as local runs and CI, CPU PyTorch.
#
#   docker build -t finmlops-model .
#   docker run --rm --env-file .env \
#       -v "$PWD/data:/app/data" -v "$PWD/outputs:/app/outputs" -v "$PWD/mlruns:/app/mlruns" \
#       -v "$PWD/mlflow.db:/app/mlflow.db" -v hf-cache:/root/.cache/huggingface \
#       finmlops-model                                  # = python -m scripts.pipeline
#   docker run ... finmlops-model python -m scripts.train baseline   # any other step
#
# data/ (news.parquet, gold.csv, the frozen benchmark) and .env are mounted at run time, never baked into the image.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.11.8 /uv /bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH"

# dependencies first, so a code change doesn't reinstall them
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --extra cpu --no-install-project

COPY scripts/ scripts/

CMD ["python", "-m", "scripts.pipeline"]
