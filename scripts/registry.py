"""MLflow model registry (champion / challenger) and pushing a model to Google Cloud Storage."""

import os
from pathlib import Path

import mlflow
import torch
from google.cloud import storage
from mlflow import MlflowClient
from mlflow.exceptions import MlflowException

from scripts.config import MLFLOW_URI
from scripts.config import REGISTRY_NAME as NAME


def setup():
    mlflow.set_tracking_uri(os.getenv("MLFLOW_TRACKING_URI", MLFLOW_URI))
    mlflow.set_experiment(NAME)


def log_model(model, tokenizer):
    """log the model in the active run and register it as a new version; returns the version"""
    info = mlflow.transformers.log_model(
        transformers_model={"model": model, "tokenizer": tokenizer},
        name="model",
        registered_model_name=NAME,
    )
    return info.registered_model_version


def load(version=None):
    """a registered version (default: the champion) as (model, tokenizer)"""
    if version is None and champion_version() is None:
        raise RuntimeError("no champion registered yet; run `uv run python -m scripts.train baseline` first")
    uri = f"models:/{NAME}/{version}" if version else f"models:/{NAME}@champion"
    parts = mlflow.transformers.load_model(uri, return_type="components")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    return parts["model"].to(device), parts["tokenizer"]


def champion_version():
    try:
        return MlflowClient().get_model_version_by_alias(NAME, "champion").version
    except MlflowException:
        return None


def promote(version):
    MlflowClient().set_registered_model_alias(NAME, "champion", version)


def push_to_gcs(version, bucket=None):
    """copy a registered version's files to gs://<bucket>/models/finbert-sentiment/v<version>/"""
    bucket = storage.Client().bucket(bucket or os.environ["MODEL_BUCKET"])
    local = Path(mlflow.artifacts.download_artifacts(f"models:/{NAME}/{version}"))
    prefix = f"models/{NAME}/v{version}"
    for f in local.rglob("*"):
        if f.is_file():
            bucket.blob(f"{prefix}/{f.relative_to(local)}").upload_from_filename(f)
    return f"gs://{bucket.name}/{prefix}"
