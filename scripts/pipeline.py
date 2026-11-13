"""The whole model pipeline: train -> validate -> champion vs challenger -> registry push -> email.

uv run python -m scripts.pipeline          # train with the default params
uv run python -m scripts.pipeline --tune   # run the Optuna search first

The first run also scores and registers the pretrained FinBERT baseline (the first champion).
Exit code 1 when the challenger fails validation, so CI marks the run as failed.
"""

import logging
import os
import smtplib
import sys
from email.message import EmailMessage

import mlflow
from dotenv import load_dotenv

from scripts import analysis, registry
from scripts.config import MIN_F1
from scripts.data import load_eval
from scripts.evaluate import evaluate_version, is_better
from scripts.train import baseline, train, tune

load_dotenv()
log = logging.getLogger(__name__)


def notify(subject, body):
    """email via Gmail (settings in .env, like the data pipeline); never raises so it can't hide the real error"""
    user = os.environ.get("GMAIL_USERNAME")
    password = os.environ.get("GMAIL_APP_PASSWORD")
    recipients = [r.strip() for r in os.environ.get("ALERT_RECIPIENTS", "").split(",") if r.strip()]
    if not (user and password and recipients):
        log.warning("email alerts not configured (see .env): %s", subject)
        return False
    msg = EmailMessage()
    msg["Subject"] = f"[FinMLOps model] {subject}"
    msg["From"] = f"FinMLOps model pipeline <{user}>"
    msg["To"] = ", ".join(recipients)
    msg.set_content(body)
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as smtp:
            smtp.login(user, password)
            smtp.send_message(msg)
    except Exception as exc:
        log.error("email alert failed: %s", exc)
        return False
    return True


def decide(new, old, version, champion):
    """the promotion rule on two metric dicts; returns (status, message)"""
    summary = (f"challenger v{version}: macro F1 {new['f1_macro']:.3f}\n"
               f"champion v{champion}: macro F1 {old['f1_macro']:.3f}")
    if new["f1_macro"] < MIN_F1:
        return "failed validation", f"macro F1 below {MIN_F1}\n{summary}"
    if not is_better(new, old):
        return "kept champion", f"challenger is not better, champion v{champion} stays (rollback)\n{summary}"
    return "promoted", f"v{version} is the new champion\n{summary}"


def run(do_tune=False):
    """train a challenger, compare it with the champion on the eval set, promote it if it wins"""
    registry.setup()
    champion = registry.champion_version()
    if champion is None:
        log.info("no champion yet: scoring the pretrained FinBERT baseline first")
        baseline()
        champion = registry.champion_version()
    params = tune() if do_tune else None
    log.info("training the challenger with %s", params or "default params")
    version = train(params)["version"]
    df = load_eval()
    new, new_df = evaluate_version(version, df)
    old, old_df = evaluate_version(champion, df)
    analysis.plot_confusion(new_df, "challenger")
    analysis.plot_confusion(old_df, "champion")
    analysis.plot_compare({f"champion v{champion}": old, f"challenger v{version}": new})

    with mlflow.start_run(run_name=f"select-v{version}"):
        mlflow.log_params({"challenger": version, "champion": champion})
        mlflow.log_metrics({f"challenger_{k}": v for k, v in new.items()})
        mlflow.log_metrics({f"champion_{k}": v for k, v in old.items()})
        mlflow.log_artifacts(str(analysis.OUT_DIR / "plots"), "plots")

    status, message = decide(new, old, version, champion)
    if status == "promoted":
        registry.promote(version)
        where = registry.push_to_gcs(version) if os.getenv("MODEL_BUCKET") else "not pushed (MODEL_BUCKET not set)"
        message += f"\npushed to {where}"
    return status, message


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        status, message = run(do_tune="--tune" in sys.argv)
    except Exception as exc:
        notify("pipeline crashed", repr(exc))
        raise
    print(status, message, sep="\n")
    notify(status, message)
    if status == "failed validation":
        sys.exit(1)


if __name__ == "__main__":
    main()
