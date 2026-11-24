"""MLflow model registry (champion / challenger) and pushing a model to Google Cloud Storage.

uv run python -m scripts.registry push [VERSION]   # copy a version (default: the champion) to MODEL_BUCKET
uv run python -m scripts.registry publish          # write registry.json (which version is champion) to MODEL_BUCKET

The bucket is what the deployment reads: gs://<bucket>/models/finbert-sentiment/registry.json names the champion,
and v<N>/ holds each pushed version's files (see scripts/deploy.py).
"""

import json
import os
import sys
from pathlib import Path

import mlflow
import mlflow.transformers  # loaded up front: MLflow otherwise swaps it in lazily on first use
import torch
import transformers
from google.cloud import storage
from mlflow import MlflowClient
from mlflow.exceptions import MlflowException

from scripts import hardware
from scripts.config import MLFLOW_URI, ROOT, TICKER_NAMES
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


def load_dir(path):
    """a model folder copied out of the registry (what push_to_gcs uploads), loaded without a tracking server"""
    parts = mlflow.transformers.load_model(str(path), return_type="components")
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


def versions():
    """every registered version with the metrics its run logged (test_* for LoRA runs, plain for the baseline)"""
    client = MlflowClient()
    champ = champion_version()
    out = []
    for v in client.search_model_versions(f"name='{NAME}'"):
        run = client.get_run(v.run_id)
        m = run.data.metrics
        p = "test_" if "test_f1_macro" in m else ""
        out.append({
            "version": int(v.version),
            "run": run.info.run_name,
            "created": v.creation_timestamp,
            "champion": v.version == champ,
            "f1_macro": m.get(f"{p}f1_macro"),
            "accuracy": m.get(f"{p}accuracy"),
            "per_ticker": {t: m.get(f"{p}accuracy_{t}") for t in TICKER_NAMES},
        })
    return sorted(out, key=lambda r: -r["version"])


def bucket_name(bucket=None):
    name = (bucket or os.getenv("MODEL_BUCKET") or "").strip().removeprefix("gs://").strip("/")
    if not name:
        raise ValueError("no bucket given; set MODEL_BUCKET in .env")
    return name


def push_to_gcs(version, bucket=None):
    """copy a registered version's files to gs://<bucket>/models/finbert-sentiment/v<version>/"""
    name = bucket_name(bucket)
    gcs = storage.Client().bucket(name)
    local = Path(mlflow.artifacts.download_artifacts(f"models:/{NAME}/{version}"))
    files = [f for f in local.rglob("*") if f.is_file()]
    if not files:
        raise RuntimeError(f"model v{version} has no files to push")
    prefix = f"models/{NAME}/v{version}"
    for f in files:
        gcs.blob(f"{prefix}/{f.relative_to(local).as_posix()}").upload_from_filename(str(f))
    return f"gs://{name}/{prefix}"


def publish(bucket=None):
    """write registry.json (the champion and every version's scores) next to the pushed models; the deployment
    reads it to find the champion, and the deployed Models page shows it. Run after promote()."""
    champ = champion_version()
    if champ is None:
        raise RuntimeError("no champion to publish")
    name = bucket_name(bucket)
    path = f"models/{NAME}/registry.json"
    body = json.dumps({"champion": str(champ), "versions": versions()}, indent=1)
    storage.Client().bucket(name).blob(path).upload_from_string(body, content_type="application/json")
    return f"gs://{name}/{path}"


def main(args):
    if args == ["publish"]:
        setup()
        print(f"champion v{champion_version()} -> {publish()}")
        return
    if not args or args[0] != "push" or len(args) > 2 or (len(args) == 2 and not args[1].isdigit()):
        sys.exit("usage: python -m scripts.registry push [VERSION] | publish")
    setup()
    version = args[1] if len(args) == 2 else champion_version()
    if version is None:
        sys.exit("no champion registered yet; run `uv run python -m scripts.train baseline` first")
    print(f"v{version} -> {push_to_gcs(version)}")


if __name__ == "__main__":
    main(sys.argv[1:])
