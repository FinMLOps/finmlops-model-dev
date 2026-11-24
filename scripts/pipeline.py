"""The whole model pipeline: train -> validate -> champion vs challenger -> registry push -> email.

uv run python -m scripts.pipeline          # train with the default params
uv run python -m scripts.pipeline --tune   # run the Optuna search first

The first run also scores and registers the pretrained FinBERT baseline (the first champion).
Exit code 1 when the challenger fails validation, so CI marks the run as failed.
"""

import logging
import os
import shutil
import smtplib
import sys
import traceback
from email.message import EmailMessage

import mlflow

from scripts import analysis, registry, slices
from scripts.benchmark import load_eval
from scripts.config import CONFIDENCE, MIN_F1, setup_logging
from scripts.evaluate import evaluate_version, f1_gain, is_better
from scripts.train import baseline, train, tune

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


def decide(new, old, version, champion, gain):
    """the promotion rule; gain = (macro F1 gain, low, high) from evaluate.f1_gain. Returns (status, message).

    Promoted only if the challenger clears MIN_F1, its gain is above zero even at the low end of the confidence
    interval (so it isn't luck of a small test set), and it is not worse than the champion for any ticker.
    """
    g, low, high = gain
    summary = (f"challenger v{version}: macro F1 {new['f1_macro']:.3f}\n"
               f"champion v{champion}: macro F1 {old['f1_macro']:.3f}\n"
               f"gain {g:+.3f} ({CONFIDENCE:.0%} interval {low:+.3f} to {high:+.3f})")
    if new["f1_macro"] < MIN_F1:
        return "failed validation", f"macro F1 below {MIN_F1}\n{summary}"
    if low <= 0:
        return "kept champion", f"the gain could be chance, champion v{champion} stays (rollback)\n{summary}"
    if not is_better(new, old):
        return "kept champion", f"challenger is worse for a ticker, champion v{champion} stays (rollback)\n{summary}"
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
    log.info("training the challenger with %s", params or "the default params")
    version = train(params)["version"]
    df = load_eval()
    new, new_df = evaluate_version(version, df)
    old, old_df = evaluate_version(champion, df)
    gain = f1_gain(new_df, old_df)
    status, message = decide(new, old, version, champion, gain)

    for folder in (analysis.PLOTS_DIR, slices.SLICE_DIR):  # so only this run's charts get logged
        shutil.rmtree(folder, ignore_errors=True)
    analysis.plot_confusion(new_df, "challenger")
    analysis.plot_confusion(old_df, "champion")
    analysis.plot_compare({f"champion v{champion}": old, f"challenger v{version}": new})
    gaps, flagged = slices.report(new_df, f"challenger v{version}")  # bias check: every slice of the eval set
    if flagged:
        message += f"\nwarning: accuracy differs a lot across {', '.join(flagged)} (see the slice report in MLflow)"
    with mlflow.start_run(run_name=f"select-v{version}"):
        mlflow.set_tag("decision", status)
        mlflow.log_params({"challenger": version, "champion": champion, "slices_flagged": ", ".join(flagged) or "none"})
        mlflow.log_metrics({f"challenger_{k}": v for k, v in new.items()})
        mlflow.log_metrics({f"champion_{k}": v for k, v in old.items()})
        mlflow.log_metrics({"f1_gain": gain[0], "f1_gain_low": gain[1], "f1_gain_high": gain[2]})
        mlflow.log_metrics({f"slice_gap_{k}": v for k, v in gaps.items()})
        mlflow.log_artifacts(str(analysis.PLOTS_DIR), "plots")
        mlflow.log_artifacts(str(slices.SLICE_DIR), "slices")

    if status == "promoted":
        # copy to GCS before moving the alias: if the upload fails, the old champion simply stays
        where = registry.push_to_gcs(version) if os.getenv("MODEL_BUCKET") else "not pushed (MODEL_BUCKET not set)"
        registry.promote(version)
        message += f"\npushed to {where}"
        if os.getenv("MODEL_BUCKET"):  # registry.json tells the deployment (and its Models page) about the new champion
            message += f"\nregistry published to {registry.publish()}"
    return status, message


def main():
    setup_logging()
    try:
        status, message = run(do_tune="--tune" in sys.argv[1:])
    except Exception:
        notify("pipeline crashed", traceback.format_exc())
        raise
    print(status, message, sep="\n")
    if os.getenv("GITHUB_OUTPUT"):  # lets the train workflow start a deploy only when a new champion was promoted
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"status={status}\n")
    notify(status, message)
    if status == "failed validation":
        sys.exit(1)


if __name__ == "__main__":
    main()
