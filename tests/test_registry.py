from unittest.mock import MagicMock

import pytest
from mlflow.exceptions import MlflowException
from mlflow.protos.databricks_pb2 import INTERNAL_ERROR, INVALID_PARAMETER_VALUE, RESOURCE_DOES_NOT_EXIST

from scripts import registry


@pytest.mark.parametrize("code", [RESOURCE_DOES_NOT_EXIST, INVALID_PARAMETER_VALUE])
def test_champion_version_is_none_when_there_is_no_champion(monkeypatch, code):
    client = MagicMock()
    client.get_model_version_by_alias.side_effect = MlflowException("not found", code)
    monkeypatch.setattr(registry, "MlflowClient", lambda: client)
    assert registry.champion_version() is None


def test_champion_version_raises_other_errors(monkeypatch):
    """a server problem must not look like "no champion", or the baseline would get promoted again"""
    client = MagicMock()
    client.get_model_version_by_alias.side_effect = MlflowException("server down", INTERNAL_ERROR)
    monkeypatch.setattr(registry, "MlflowClient", lambda: client)
    with pytest.raises(MlflowException, match="server down"):
        registry.champion_version()


def test_setup_treats_an_empty_setting_as_unset(monkeypatch):
    fake = MagicMock()
    fake.get_experiment_by_name.return_value = None
    monkeypatch.setattr(registry, "mlflow", fake)
    monkeypatch.setenv("MLFLOW_TRACKING_URI", "")  # what `MLFLOW_TRACKING_URI=` in .env gives
    registry.setup()
    fake.set_tracking_uri.assert_called_once_with(registry.MLFLOW_URI)
    location = fake.create_experiment.call_args.kwargs["artifact_location"]
    assert location.endswith("/mlruns") and location.startswith("file://")


def test_load_without_champion_explains_what_to_do(monkeypatch):
    monkeypatch.setattr(registry, "champion_version", lambda: None)
    with pytest.raises(RuntimeError, match="baseline"):
        registry.load()


def test_requirements_are_pinned_and_minimal():
    reqs = registry.requirements()
    assert [r.split("==")[0] for r in reqs] == ["torch", "transformers"]  # no torchvision, no peft
    assert all("==" in r and "+" not in r for r in reqs)  # exact versions, no +cpu / +cu132 build tag


def test_log_model_passes_the_requirements(monkeypatch):
    log_mock = MagicMock()
    log_mock.return_value.registered_model_version = "1"
    monkeypatch.setattr(registry.mlflow.transformers, "log_model", log_mock)
    assert registry.log_model("fake_model", "fake_tokenizer") == "1"
    assert log_mock.call_args.kwargs["pip_requirements"] == registry.requirements()


def test_push_to_gcs_uploads_every_file(tmp_path, monkeypatch):
    (tmp_path / "sub").mkdir()
    (tmp_path / "config.json").write_text("{}")
    (tmp_path / "sub" / "weights.bin").write_text("w")
    monkeypatch.setattr(registry.mlflow.artifacts, "download_artifacts", lambda uri: str(tmp_path))
    bucket = MagicMock()
    monkeypatch.setattr(registry.storage, "Client", lambda: MagicMock(bucket=lambda name: bucket))
    where = registry.push_to_gcs("3", bucket="gs://my-bucket/")
    assert where == "gs://my-bucket/models/finbert-sentiment/v3"
    uploaded = sorted(call.args[0] for call in bucket.blob.call_args_list)
    assert uploaded == ["models/finbert-sentiment/v3/config.json", "models/finbert-sentiment/v3/sub/weights.bin"]
    with pytest.raises(ValueError, match="MODEL_BUCKET"):
        registry.push_to_gcs("3")
