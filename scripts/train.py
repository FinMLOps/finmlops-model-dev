"""Train models: the pretrained FinBERT baseline, LoRA fine-tuning, and the Optuna hyperparameter search.

uv run python -m scripts.train baseline   # score + register pretrained FinBERT (first champion)
uv run python -m scripts.train            # one LoRA run with the default params
uv run python -m scripts.train tune       # Optuna search
"""

import sys

import mlflow
import optuna
import torch
import torch.nn.functional as F
from peft import LoraConfig, TaskType, get_peft_model
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from scripts import benchmark, registry
from scripts.config import BASE, DEFAULTS, GOLD_PATH, MAX_LENGTH, SEED, STORAGE, STUDY
from scripts.data import data_info, load_eval, load_gold, load_labeled, split_by_date
from scripts.evaluate import metrics, predict

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


def baseline():
    """score pretrained FinBERT on the frozen benchmark, register it, and make it the champion if there is none yet"""
    registry.setup()
    tokenizer = AutoTokenizer.from_pretrained(BASE)
    model = AutoModelForSequenceClassification.from_pretrained(BASE).to(DEVICE)
    bench = benchmark.run(model, tokenizer)
    if GOLD_PATH.exists():  # the gold set decides promotion once we have it
        df = load_eval()
        df["pred"] = predict(model, tokenizer, df["text"].tolist())
    else:
        df = bench.assign(pred=bench["finbert_pred"])
    results = metrics(df)
    extra = benchmark.report(bench)
    if GOLD_PATH.exists():  # how far we can trust Marketaux's labels
        extra.update(benchmark.agreement(load_gold()))
    with mlflow.start_run(run_name="baseline"):
        mlflow.log_params({"model": BASE, "eval_rows": len(df), "bench_rows": len(bench), **data_info()})
        mlflow.log_metrics({**results, **extra})
        version = registry.log_model(model, tokenizer)
    if registry.champion_version() is None:
        registry.promote(version)
    return results


def build_model(p):
    """pretrained FinBERT with LoRA adapters on attention query/value; only those and the classifier head train"""
    model = AutoModelForSequenceClassification.from_pretrained(BASE)
    config = LoraConfig(task_type=TaskType.SEQ_CLS, r=p["r"], lora_alpha=p["alpha"],
                        lora_dropout=p["dropout"], target_modules=["query", "value"])
    return get_peft_model(model, config)


def class_weights(labels, n_classes):
    """inverse-frequency weights so the rare classes (negative, neutral) count as much as positive in the loss"""
    counts = torch.bincount(labels, minlength=n_classes).float().clamp(min=1)
    return counts.sum() / (n_classes * counts)


def fit(model, tokenizer, df, p):
    """plain PyTorch training loop; logs the mean training loss per epoch"""
    if df.empty:
        raise ValueError("no training rows; check TEST_START and the data snapshot")
    torch.manual_seed(SEED)
    model.to(DEVICE).train()
    opt = torch.optim.AdamW([w for w in model.parameters() if w.requires_grad], lr=p["lr"])
    texts = df["text"].tolist()
    labels = torch.tensor([model.config.label2id[label] for label in df["label"]])
    weight = class_weights(labels, model.config.num_labels).to(DEVICE)
    for epoch in range(p["epochs"]):
        losses = []
        order = torch.randperm(len(texts)).tolist()
        for i in range(0, len(order), p["batch_size"]):
            idx = order[i : i + p["batch_size"]]
            batch = tokenizer([texts[j] for j in idx], padding=True, truncation=True,
                              max_length=MAX_LENGTH, return_tensors="pt").to(DEVICE)
            logits = model(**batch).logits
            loss = F.cross_entropy(logits, labels[idx].to(DEVICE), weight=weight)
            loss.backward()
            opt.step()
            opt.zero_grad()
            losses.append(loss.item())
        mlflow.log_metric("train_loss", sum(losses) / len(losses), step=epoch)
    return model


def train(params=None, save=True, run_name="lora"):
    """one LoRA run; returns run id, registered version (if saved) and val/test metrics"""
    registry.setup()
    p = {**DEFAULTS, **(params or {})}
    train_df, val_df, test_df = split_by_date(load_labeled())
    tokenizer = AutoTokenizer.from_pretrained(BASE)
    with mlflow.start_run(run_name=run_name, nested=True) as run:
        mlflow.log_params({**p, "train_rows": len(train_df), **data_info()})
        model = fit(build_model(p), tokenizer, train_df, p)
        results = {}
        for name, df in [("val", val_df), ("test", test_df)]:
            df = df.assign(pred=predict(model, tokenizer, df["text"].tolist()))
            results[name] = metrics(df)
            mlflow.log_metrics({f"{name}_{k}": v for k, v in results[name].items()})
        version = registry.log_model(model.merge_and_unload(), tokenizer) if save else None
    return {"run_id": run.info.run_id, "version": version, **results}


def objective(trial):
    """one Optuna trial = one unsaved LoRA run, scored on validation (never on the test set)"""
    params = {
        "lr": trial.suggest_float("lr", 1e-5, 5e-4, log=True),
        "r": trial.suggest_categorical("r", [4, 8, 16]),
        "alpha": trial.suggest_categorical("alpha", [8, 16, 32]),
        "dropout": trial.suggest_float("dropout", 0.0, 0.3),
        "epochs": trial.suggest_int("epochs", 2, 4),
    }
    return train(params, save=False, run_name=f"trial-{trial.number}")["val"]["f1_macro"]


def tune(n_trials=10):
    """Optuna search, each trial a nested MLflow run; the study is kept in optuna.db for analysis.py"""
    registry.setup()
    study = optuna.create_study(study_name=STUDY, storage=STORAGE, direction="maximize", load_if_exists=True,
                                sampler=optuna.samplers.TPESampler(seed=SEED))
    with mlflow.start_run(run_name="tune"):
        study.optimize(objective, n_trials=n_trials)
        mlflow.log_params({f"best_{k}": v for k, v in study.best_params.items()})
        mlflow.log_metric("best_val_f1_macro", study.best_value)
    return study.best_params


if __name__ == "__main__":
    commands = {"baseline": baseline, "lora": train, "tune": tune}
    cmd = sys.argv[1] if len(sys.argv) > 1 else "lora"
    if cmd not in commands:
        sys.exit(f"usage: python -m scripts.train [{'|'.join(commands)}]")
    print(commands[cmd]())
