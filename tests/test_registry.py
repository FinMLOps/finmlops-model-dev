from unittest.mock import MagicMock

import pytest
from mlflow.exceptions import MlflowException

from scripts import registry


def test_champion_version_is_none_without_alias(monkeypatch):
    client = MagicMock()
    client.get_model_version_by_alias.side_effect = MlflowException("no alias")
    monkeypatch.setattr(registry, "MlflowClient", lambda: client)
    assert registry.champion_version() is None


def test_load_without_champion_explains_what_to_do(monkeypatch):
    monkeypatch.setattr(registry, "champion_version", lambda: None)
    with pytest.raises(RuntimeError, match="baseline"):
        registry.load()


def test_push_to_gcs_uploads_every_file(tmp_path, monkeypatch):
    (tmp_path / "sub").mkdir()
    (tmp_path / "config.json").write_text("{}")
    (tmp_path / "sub" / "weights.bin").write_text("w")
    monkeypatch.setattr(registry.mlflow.artifacts, "download_artifacts", lambda uri: str(tmp_path))
    bucket = MagicMock()
    bucket.name = "my-bucket"
    monkeypatch.setattr(registry.storage, "Client", lambda: MagicMock(bucket=lambda name: bucket))
    where = registry.push_to_gcs("3", bucket="my-bucket")
    assert where == "gs://my-bucket/models/finbert-sentiment/v3"
    uploaded = sorted(call.args[0] for call in bucket.blob.call_args_list)
    assert uploaded == ["models/finbert-sentiment/v3/config.json", "models/finbert-sentiment/v3/sub/weights.bin"]
