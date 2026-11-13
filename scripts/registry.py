"""MLflow model registry (champion / challenger) and pushing a model to Google Cloud Storage."""

import os
from pathlib import Path

import mlflow
import mlflow.transformers  # loaded up front: MLflow otherwise swaps it in lazily on first use
import torch
import transformers
from google.cloud import storage
from mlflow import MlflowClient
from mlflow.exceptions import MlflowException

from scripts import hardware
from scripts.config import MLFLOW_URI, ROOT
from scripts.config import REGISTRY_NAME as NAME

# what MLflow answers when there is no registered model yet, or no champion alias yet
NOT_FOUND = {"RESOURCE_DOES_NOT_EXIST", "INVALID_PARAMETER_VALUE"}


def setup():
    """point MLflow at MLFLOW_TRACKING_URI (a shared server) or else the local mlflow.db"""
    uri = os.getenv("MLFLOW_TRACKING_URI") or MLFLOW_URI  # `or`: an empty value in .env means "not set"
    mlflow.set_tracking_uri(uri)
    if uri == MLFLOW_URI and mlflow.get_experiment_by_name(NAME) is None:
        # pin the artifact folder to the repo, otherwise MLflow puts it wherever the script was started from
        mlflow.create_experiment(NAME, artifact_location=(ROOT / "mlruns").as_uri())
    mlflow.set_experiment(NAME)


def requirements():
    """what loading a registered model needs, pinned to the versions that saved it. Given explicitly so MLflow
    doesn't guess (its guess wants torchvision). The saved model has LoRA merged in, so peft isn't needed."""
    torch_version = torch.__version__.split("+")[0]  # drop the build tag: 2.15.0+cu132 -> 2.15.0
    return [f"torch=={torch_version}", f"transformers=={transformers.__version__}"]


def log_model(model, tokenizer):
    """log the model in the active run and register it as a new version; returns the version"""
    info = mlflow.transformers.log_model(
        transformers_model={"model": model, "tokenizer": tokenizer},
        name="model",
        registered_model_name=NAME,
        pip_requirements=requirements(),
    )
    return info.registered_model_version


def load(version=None):
    """a registered version (default: the champion) as (model, tokenizer), on the best device here"""
    if version is None:
        version = champion_version()
        if version is None:
            raise RuntimeError("no champion registered yet; run `uv run python -m scripts.train baseline` first")
    parts = mlflow.transformers.load_model(f"models:/{NAME}/{version}", return_type="components")
    return parts["model"].to(hardware.device()).eval(), parts["tokenizer"]


def champion_version():
    """the champion's version, or None if there is none yet. Any other error (server down, no access) is raised,
    so it can't be mistaken for "no champion" and get a new model promoted by accident."""
    try:
        return MlflowClient().get_model_version_by_alias(NAME, "champion").version
    except MlflowException as exc:
        if exc.error_code in NOT_FOUND:
            return None
        raise


def promote(version):
    MlflowClient().set_registered_model_alias(NAME, "champion", version)


def push_to_gcs(version, bucket=None):
    """copy a registered version's files to gs://<bucket>/models/finbert-sentiment/v<version>/"""
    name = (bucket or os.getenv("MODEL_BUCKET") or "").strip().removeprefix("gs://").strip("/")
    if not name:
        raise ValueError("no bucket given; set MODEL_BUCKET in .env")
    gcs = storage.Client().bucket(name)
    local = Path(mlflow.artifacts.download_artifacts(f"models:/{NAME}/{version}"))
    files = [f for f in local.rglob("*") if f.is_file()]
    if not files:
        raise RuntimeError(f"model v{version} has no files to push")
    prefix = f"models/{NAME}/v{version}"
    for f in files:
        gcs.blob(f"{prefix}/{f.relative_to(local).as_posix()}").upload_from_filename(str(f))
    return f"gs://{name}/{prefix}"
