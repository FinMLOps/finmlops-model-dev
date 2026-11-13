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

from scripts import registry
from scripts.config import LABELS, OUT_DIR, STORAGE, STUDY
from scripts.data import load_eval
from scripts.evaluate import metrics, predict

log = logging.getLogger(__name__)


def save(fig, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, bbox_inches="tight")
    plt.close("all")


# --- result charts ---

def plot_confusion(df, name, out_dir=OUT_DIR / "plots"):
    disp = ConfusionMatrixDisplay.from_predictions(df["label"], df["pred"], labels=LABELS)
    disp.ax_.set_title(name)
    save(disp.figure_, out_dir / f"confusion_{name}.png")


def plot_compare(results, out_dir=OUT_DIR / "plots"):
    """results: {model name: metrics dict}; one chart overall, one per ticker"""
    table = pd.DataFrame(results)
    charts = {
        "overall": ["f1_macro", "accuracy", "precision_macro", "recall_macro"],
        "per_ticker": [k for k in table.index if k.startswith("accuracy_")],
    }
    for name, rows in charts.items():
        save(table.loc[rows].plot.bar(title=name, ylim=(0, 1)).figure, out_dir / f"compare_{name}.png")


# --- sensitivity ---

def word_importance(model, tokenizer, texts, out_dir=OUT_DIR / "sensitivity"):
    """SHAP: which words push headlines toward positive / negative"""
    clf = pipeline("text-classification", model=model, tokenizer=tokenizer, top_k=None, device=model.device)
    values = shap.Explainer(clf)(texts)
    for label in ["positive", "negative"]:
        shap.plots.bar(values[:, :, label].mean(0), max_display=15, show=False)
        save(plt.gcf(), out_dir / f"shap_{label}.png")
    (out_dir / "shap_examples.html").write_text(shap.plots.text(values[:20], display=False))


def input_fields(model, tokenizer, df):
    """does the summary help? macro F1 on the title only vs title + summary"""
    return {col: metrics(df.assign(pred=predict(model, tokenizer, df[col].tolist())))["f1_macro"]
            for col in ["title", "text"]}


def param_importance(out_dir=OUT_DIR / "sensitivity"):
    """which hyperparameters mattered most in the Optuna search"""
    study = optuna.load_study(study_name=STUDY, storage=STORAGE)
    save(optuna.visualization.matplotlib.plot_param_importances(study).figure, out_dir / "param_importance.png")
    return optuna.importance.get_param_importances(study)


def sensitivity(version=None, n_shap=100):
    """explain a registered model (default: the champion) and log everything to MLflow"""
    registry.setup()
    version = version or registry.champion_version()
    model, tokenizer = registry.load(version)
    df = load_eval()
    word_importance(model, tokenizer, df["text"].tolist()[:n_shap])
    results = {"f1_by_input": input_fields(model, tokenizer, df)}
    try:
        results["param_importance"] = param_importance()
    except KeyError:  # optuna.load_study raises KeyError when the study doesn't exist
        log.warning("no Optuna study yet; run `uv run python -m scripts.train tune` for parameter importance")
    with mlflow.start_run(run_name=f"sensitivity-v{version}"):
        mlflow.log_param("version", version)
        mlflow.log_metrics({f"f1_{col}_only": v for col, v in results["f1_by_input"].items()})
        mlflow.log_metrics({f"importance_{k}": v for k, v in results.get("param_importance", {}).items()})
        mlflow.log_artifacts(str(OUT_DIR / "sensitivity"), "sensitivity")
    return results


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(sensitivity())
