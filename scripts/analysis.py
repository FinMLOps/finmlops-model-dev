"""Reports: result charts and sensitivity analysis (SHAP, Optuna).

uv run python -m scripts.analysis   # sensitivity analysis of the champion
"""

import logging

import matplotlib

matplotlib.use("Agg")  # no screen in Docker / CI; charts are only saved to files
import matplotlib.pyplot as plt  # noqa: E402
import mlflow
import optuna
import pandas as pd
import shap
from sklearn.metrics import ConfusionMatrixDisplay
from transformers import pipeline

from scripts import hardware, registry
from scripts.benchmark import load_eval
from scripts.config import LABELS, OUT_DIR, SHAP_ROWS, STORAGE, setup_logging
from scripts.data import study_name
from scripts.evaluate import metrics, predict

log = logging.getLogger(__name__)
PLOTS_DIR = OUT_DIR / "plots"
SENSITIVITY_DIR = OUT_DIR / "sensitivity"


def save(fig, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, bbox_inches="tight")
    plt.close("all")


# --- result charts ---

def plot_confusion(df, name, out_dir=PLOTS_DIR):
    disp = ConfusionMatrixDisplay.from_predictions(df["label"], df["pred"], labels=LABELS)
    disp.ax_.set_title(name)
    save(disp.figure_, out_dir / f"confusion_{name}.png")


def plot_compare(results, out_dir=PLOTS_DIR):
    """results: {model name: metrics dict}; one chart overall, one per ticker"""
    table = pd.DataFrame(results)
    charts = {
        "overall": ["f1_macro", "accuracy", "precision_macro", "recall_macro"],
        "per_ticker": [k for k in table.index if k.startswith("accuracy_")],
    }
    for name, rows in charts.items():
        rows = [r for r in rows if r in table.index]
        if rows:
            save(table.loc[rows].plot.bar(title=name, ylim=(0, 1)).figure, out_dir / f"compare_{name}.png")


# --- sensitivity ---

def word_importance(model, tokenizer, texts, out_dir=SENSITIVITY_DIR):
    """SHAP: which words push headlines toward positive / negative"""
    clf = pipeline("text-classification", model=model, tokenizer=tokenizer, top_k=None, device=model.device)
    values = shap.Explainer(clf)(texts)
    for label in ["positive", "negative"]:
        shap.plots.bar(values[:, :, label].mean(0), max_display=15, show=False)
        save(plt.gcf(), out_dir / f"shap_{label}.png")
    (out_dir / "shap_examples.html").write_text(shap.plots.text(values[:20], display=False), encoding="utf-8")


def input_fields(model, tokenizer, df):
    """does the summary help? macro F1 on the title only vs title + summary"""
    return {col: metrics(df.assign(pred=predict(model, tokenizer, df[col].tolist())))["f1_macro"]
            for col in ["title", "text"]}


def param_importance(out_dir=SENSITIVITY_DIR):
    """which hyperparameters mattered most in the Optuna search (needs at least two finished trials)"""
    study = optuna.load_study(study_name=study_name(), storage=STORAGE)
    save(optuna.visualization.matplotlib.plot_param_importances(study).figure, out_dir / "param_importance.png")
    return optuna.importance.get_param_importances(study)


def sensitivity(version=None, n_shap=SHAP_ROWS):
    """explain a registered model (default: the champion) and log everything to MLflow"""
    registry.setup()
    version = version or registry.champion_version()
    model, tokenizer = registry.load(version)
    df = load_eval()
    log.info("SHAP on %d headlines (slow without a GPU)", min(n_shap, len(df)))
    word_importance(model, tokenizer, df["text"].tolist()[:n_shap])
    results = {"f1_by_input": input_fields(model, tokenizer, df)}
    del model
    hardware.free_memory()
    try:
        results["param_importance"] = param_importance()
    except KeyError:  # optuna.load_study raises KeyError when there is no study for this data yet
        log.warning("no Optuna study for this data yet; run `uv run python -m scripts.train tune` first")
    except (RuntimeError, ValueError) as exc:  # e.g. fewer than two finished trials
        log.warning("skipping hyperparameter importance: %s", exc)
    with mlflow.start_run(run_name=f"sensitivity-v{version}"):
        mlflow.log_param("version", version)
        mlflow.log_metrics({f"f1_{col}_only": v for col, v in results["f1_by_input"].items()})
        mlflow.log_metrics({f"importance_{k}": v for k, v in results.get("param_importance", {}).items()})
        mlflow.log_artifacts(str(SENSITIVITY_DIR), "sensitivity")
    return results


if __name__ == "__main__":
    setup_logging()
    print(sensitivity())
