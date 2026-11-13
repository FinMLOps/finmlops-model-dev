from unittest.mock import MagicMock

import pytest

from scripts import pipeline

OLD = {"f1_macro": 0.70, "accuracy_AAPL": 0.80}


@pytest.mark.parametrize("new, status", [
    ({"f1_macro": 0.50, "accuracy_AAPL": 0.90}, "failed validation"),
    ({"f1_macro": 0.69, "accuracy_AAPL": 0.90}, "kept champion"),
    ({"f1_macro": 0.75, "accuracy_AAPL": 0.60}, "kept champion"),
    ({"f1_macro": 0.75, "accuracy_AAPL": 0.80}, "promoted"),
])
def test_decide(new, status):
    assert pipeline.decide(new, OLD, 2, 1)[0] == status


def test_notify_skips_without_settings(monkeypatch):
    monkeypatch.delenv("GMAIL_USERNAME", raising=False)
    assert pipeline.notify("subject", "body") is False


def test_notify_sends_and_never_raises(monkeypatch):
    for key, value in [("GMAIL_USERNAME", "a@gmail.com"), ("GMAIL_APP_PASSWORD", "x"), ("ALERT_RECIPIENTS", "b@x.com")]:
        monkeypatch.setenv(key, value)
    smtp = MagicMock()
    monkeypatch.setattr(pipeline.smtplib, "SMTP_SSL", smtp)
    assert pipeline.notify("promoted", "body") is True
    msg = smtp.return_value.__enter__.return_value.send_message.call_args.args[0]
    assert msg["Subject"] == "[FinMLOps model] promoted"
    smtp.side_effect = OSError("network down")
    assert pipeline.notify("promoted", "body") is False


@pytest.fixture
def fake_run(monkeypatch, tmp_path):
    """everything heavy in pipeline.run replaced by fakes; returns the promote mock"""
    promote = MagicMock()
    monkeypatch.setattr(pipeline.analysis, "PLOTS_DIR", tmp_path / "plots")
    monkeypatch.setattr(pipeline.registry, "setup", lambda: None)
    monkeypatch.setattr(pipeline.registry, "promote", promote)
    monkeypatch.setattr(pipeline, "train", lambda params: {"version": "2"})
    monkeypatch.setattr(pipeline, "load_eval", lambda: None)
    monkeypatch.setattr(pipeline, "mlflow", MagicMock())
    for name in ["plot_confusion", "plot_compare"]:
        monkeypatch.setattr(pipeline.analysis, name, lambda *a: None)
    return promote


def scores(by_version):
    return lambda version, df: (by_version[version], None)


def test_run_promotes_a_better_challenger(monkeypatch, fake_run):
    monkeypatch.setattr(pipeline.registry, "champion_version", lambda: "1")
    monkeypatch.setattr(pipeline, "evaluate_version", scores({"1": OLD, "2": {"f1_macro": 0.8, "accuracy_AAPL": 0.9}}))
    status, message = pipeline.run()
    assert status == "promoted"
    fake_run.assert_called_once_with("2")
    assert "not pushed" in message


def test_run_keeps_champion_and_bootstraps_baseline(monkeypatch, fake_run):
    versions = iter([None, "1"])  # no champion until the baseline is registered
    monkeypatch.setattr(pipeline.registry, "champion_version", lambda: next(versions))
    baseline = MagicMock()
    monkeypatch.setattr(pipeline, "baseline", baseline)
    monkeypatch.setattr(pipeline, "evaluate_version", scores({"1": OLD, "2": {"f1_macro": 0.65, "accuracy_AAPL": 0.9}}))
    status, _ = pipeline.run()
    assert status == "kept champion"
    baseline.assert_called_once()
    fake_run.assert_not_called()


def test_a_failed_upload_keeps_the_old_champion(monkeypatch, fake_run):
    monkeypatch.setenv("MODEL_BUCKET", "my-bucket")
    monkeypatch.setattr(pipeline.registry, "champion_version", lambda: "1")
    monkeypatch.setattr(pipeline, "evaluate_version", scores({"1": OLD, "2": {"f1_macro": 0.8, "accuracy_AAPL": 0.9}}))
    monkeypatch.setattr(pipeline.registry, "push_to_gcs", MagicMock(side_effect=OSError("bucket unreachable")))
    with pytest.raises(OSError):
        pipeline.run()
    fake_run.assert_not_called()  # the alias never moved


def test_main_emails_the_traceback_when_it_crashes(monkeypatch):
    sent = MagicMock()
    monkeypatch.setattr(pipeline, "notify", sent)
    monkeypatch.setattr(pipeline, "run", MagicMock(side_effect=ValueError("bad data")))
    monkeypatch.setattr(pipeline.sys, "argv", ["pipeline"])
    with pytest.raises(ValueError):
        pipeline.main()
    subject, body = sent.call_args.args
    assert subject == "pipeline crashed" and "Traceback" in body and "bad data" in body


def test_main_exits_with_1_when_validation_fails(monkeypatch):
    monkeypatch.setattr(pipeline, "notify", MagicMock())
    monkeypatch.setattr(pipeline, "run", lambda do_tune: ("failed validation", "macro F1 below 0.6"))
    monkeypatch.setattr(pipeline.sys, "argv", ["pipeline"])
    with pytest.raises(SystemExit) as exit_info:
        pipeline.main()
    assert exit_info.value.code == 1
