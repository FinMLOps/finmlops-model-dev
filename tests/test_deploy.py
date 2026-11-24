import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from scripts import deploy


def fake_storage(monkeypatch, files):
    """GCS replaced by a bucket holding {name: text}"""
    def blob(name):
        b = MagicMock()
        b.name = name
        b.download_as_text.return_value = files[name]
        b.download_to_filename.side_effect = lambda dest: Path(dest).write_text(files[name])
        return b
    bucket = MagicMock()
    bucket.name = "b"
    bucket.blob.side_effect = blob
    bucket.list_blobs.side_effect = lambda prefix: [blob(n) for n in files if n.startswith(prefix)]
    monkeypatch.setattr(deploy.storage, "Client", lambda: MagicMock(bucket=lambda name: bucket))


def test_pull_downloads_the_champion_named_in_registry_json(tmp_path, monkeypatch):
    p = deploy.PREFIX
    fake_storage(monkeypatch, {f"{p}/registry.json": json.dumps({"champion": "2", "versions": []}),
                               f"{p}/v1/MLmodel": "old", f"{p}/v2/MLmodel": "new", f"{p}/v2/model/config.json": "{}"})
    monkeypatch.setattr(deploy, "BUNDLE", tmp_path / "bundle")
    assert deploy.pull("b") == "2"
    assert (tmp_path / "bundle/model/MLmodel").read_text() == "new"  # v2, not v1
    assert (tmp_path / "bundle/model/model/config.json").exists()
    assert json.loads((tmp_path / "bundle/registry.json").read_text())["champion"] == "2"


def test_pull_fails_when_the_champion_was_never_pushed(tmp_path, monkeypatch):
    fake_storage(monkeypatch, {f"{deploy.PREFIX}/registry.json": json.dumps({"champion": "3", "versions": []})})
    monkeypatch.setattr(deploy, "BUNDLE", tmp_path / "bundle")
    with pytest.raises(RuntimeError, match="v3"):
        deploy.pull("b")


def test_check_passes_when_the_services_answer(monkeypatch):
    answers = {"https://api/api/health": {"status": "ok", "champion": "2", "news_as_of": "2026-11-15"},
               "https://api/api/predict": {"label": "positive"},
               "https://api/api/overview": {"tickers": [{}] * 7}}
    monkeypatch.setattr(deploy, "request", lambda url, body=None: (200, json.dumps(answers[url])))
    assert deploy.check("https://api/")["champion"] == "2"


def test_check_retries_then_says_what_failed(monkeypatch):
    monkeypatch.setattr(deploy, "request", MagicMock(side_effect=OSError("connection refused")))
    monkeypatch.setattr(deploy.time, "sleep", lambda s: None)
    with pytest.raises(RuntimeError, match="after 2 tries: connection refused"):
        deploy.check("https://api", tries=2)
