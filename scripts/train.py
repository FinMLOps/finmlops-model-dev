"""Train models: the pretrained FinBERT baseline, LoRA fine-tuning, and the Optuna hyperparameter search.

uv run python -m scripts.train baseline   # score + register pretrained FinBERT (first champion)
uv run python -m scripts.train            # one LoRA run with the default params
uv run python -m scripts.train tune [N]   # Optuna search with N trials (default N_TRIALS in config.py)

Runs on whatever is there: an NVIDIA GPU (with mixed precision), an Apple Silicon GPU, or the CPU.
TORCH_DEVICE=cpu (or mps, cuda) forces one; see hardware.py.
"""

import logging
import math
import sys

import mlflow
import optuna
import torch
import torch.nn.functional as F
from peft import LoraConfig, TaskType, get_peft_model
from tqdm import tqdm
from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup, set_seed

from scripts import benchmark, hardware, registry
from scripts.config import (BASE, BASE_REVISION, DEFAULTS, GOLD_PATH, LABELS, MAX_GRAD_NORM, MAX_LENGTH, N_TRIALS,
                            SEED, STORAGE, WARMUP_FRAC, WEIGHT_DECAY, setup_logging)
from scripts.data import data_info, drop_gold, load_gold, load_labeled, split_by_date, study_name
from scripts.evaluate import metrics, predict

log = logging.getLogger(__name__)


def load_tokenizer():
    return AutoTokenizer.from_pretrained(BASE, revision=BASE_REVISION)


def load_base():
    """pretrained FinBERT at the pinned revision; checks it predicts exactly our three labels"""
    model = AutoModelForSequenceClassification.from_pretrained(BASE, revision=BASE_REVISION)
    found = {name.lower() for name in model.config.label2id}
    if found != set(LABELS):
        raise ValueError(f"{BASE} predicts {sorted(found)}, but our labels are {LABELS}")
    return model


def baseline():
    """score pretrained FinBERT on the frozen benchmark (and the gold set if it exists), register it, and make it
    the champion if there is none yet"""
    registry.setup()
    dev = hardware.device()
    tokenizer, model = load_tokenizer(), load_base().to(dev)
    bench = benchmark.get()
    bench["pred"] = predict(model, tokenizer, bench["text"].tolist())
    extra = benchmark.report(bench)
    if GOLD_PATH.exists():  # the gold set decides promotion once we have it
        df = load_gold()
        df["pred"] = predict(model, tokenizer, df["text"].tolist())
        extra.update(benchmark.agreement(df))  # how far we can trust Marketaux's labels
    else:
        df = bench
    results = metrics(df)
    with mlflow.start_run(run_name="baseline"):
        mlflow.log_params({"model": BASE, "revision": BASE_REVISION, "eval_rows": len(df), "bench_rows": len(bench),
                           "max_length": MAX_LENGTH, **data_info(), **hardware.info(dev)})
        mlflow.log_metrics({**results, **extra})
        version = registry.log_model(model, tokenizer)
    if registry.champion_version() is None:
        registry.promote(version)
        log.info("pretrained FinBERT is v%s, the first champion", version)
    return results


def build_model(p):
    """pretrained FinBERT with LoRA adapters on attention query/value; only those and the classifier head train"""
    config = LoraConfig(task_type=TaskType.SEQ_CLS, r=p["r"], lora_alpha=p["alpha"],
                        lora_dropout=p["dropout"], target_modules=["query", "value"])
    return get_peft_model(load_base(), config)


def class_weights(labels, n_classes):
    """inverse-frequency weights so the rare classes (negative, neutral) count as much as positive in the loss"""
    counts = torch.bincount(labels, minlength=n_classes).float()
    return len(labels) / (n_classes * counts.clamp(min=1))  # clamp: a class with no rows can't divide by zero


def fit(model, tokenizer, train_df, val_df, p):
    """the training loop: class-weighted loss, AdamW with weight decay, warmup then linear decay, gradient clipping,
    mixed precision on NVIDIA GPUs, and at the end the weights of the epoch with the best validation macro F1"""
    if train_df.empty or val_df.empty:
        raise ValueError("no training or validation rows; check TEST_START and the data snapshot")
    dev = hardware.device()
    amp = hardware.amp_dtype(dev)
    model.to(dev)
    label2id = {name.lower(): i for name, i in model.config.label2id.items()}
    texts = [str(t) for t in train_df["text"]]
    labels = torch.tensor([label2id[label] for label in train_df["label"]])
    weight = class_weights(labels, len(label2id)).to(dev)

    trainable = [w for w in model.parameters() if w.requires_grad]
    opt = torch.optim.AdamW(trainable, lr=p["lr"], weight_decay=WEIGHT_DECAY)
    steps = p["epochs"] * math.ceil(len(texts) / p["batch_size"])
    schedule = get_linear_schedule_with_warmup(opt, int(WARMUP_FRAC * steps), steps)
    scaler = torch.amp.GradScaler("cuda", enabled=amp == torch.float16)  # fp16 needs loss scaling, bf16/fp32 don't

    best_f1, best_epoch, best_weights = -1.0, 0, {}
    for epoch in range(1, p["epochs"] + 1):
        model.train()
        losses = []
        order = torch.randperm(len(texts)).tolist()
        bar = tqdm(range(0, len(order), p["batch_size"]), desc=f"epoch {epoch}/{p['epochs']}", unit="batch")
        for i in bar:
            idx = order[i : i + p["batch_size"]]
            batch = tokenizer([texts[j] for j in idx], padding=True, truncation=True,
                              max_length=MAX_LENGTH, return_tensors="pt").to(dev)
            with hardware.autocast(dev, amp):
                logits = model(**batch).logits
            loss = F.cross_entropy(logits.float(), labels[idx].to(dev), weight=weight)  # the loss itself in fp32
            if not torch.isfinite(loss):
                raise FloatingPointError(f"training loss became {loss.item()} in epoch {epoch}; try a lower lr")
            scaler.scale(loss).backward()
            scaler.unscale_(opt)  # clip the real gradients, not the scaled ones
            torch.nn.utils.clip_grad_norm_(trainable, MAX_GRAD_NORM)
            scaler.step(opt)
            scaler.update()
            schedule.step()
            opt.zero_grad(set_to_none=True)
            losses.append(loss.item())
            bar.set_postfix(loss=f"{losses[-1]:.4f}")

        train_loss = sum(losses) / len(losses)
        val_f1 = metrics(val_df.assign(pred=predict(model, tokenizer, val_df["text"].tolist())))["f1_macro"]
        mlflow.log_metrics({"train_loss": train_loss, "epoch_val_f1_macro": val_f1}, step=epoch)
        log.info("epoch %d: train loss %.4f, validation macro F1 %.3f", epoch, train_loss, val_f1)
        if val_f1 > best_f1:  # keep a copy of the trainable weights (LoRA + head, a few MB) of the best epoch
            best_f1, best_epoch = val_f1, epoch
            best_weights = {n: w.detach().clone() for n, w in model.named_parameters() if w.requires_grad}

    with torch.no_grad():
        for n, w in model.named_parameters():
            if n in best_weights:
                w.copy_(best_weights[n])
    mlflow.log_metric("best_epoch", best_epoch)
    return model


def train(params=None, save=True, run_name="lora"):
    """one LoRA run; returns run id, registered version (if saved) and val/test metrics"""
    registry.setup()
    p = {**DEFAULTS, **(params or {})}
    set_seed(SEED)  # before the model is built: LoRA's starting weights are random
    train_df, val_df = split_by_date(drop_gold(load_labeled()))
    test_df = benchmark.get()
    dev = hardware.device()
    tokenizer = load_tokenizer()
    with mlflow.start_run(run_name=run_name, nested=True) as run:
        mlflow.log_params({**p, "train_rows": len(train_df), "val_rows": len(val_df), "test_rows": len(test_df),
                           "max_length": MAX_LENGTH, **data_info(), **hardware.info(dev)})
        model = fit(build_model(p), tokenizer, train_df, val_df, p)
        results = {}
        for name, df in [("val", val_df), ("test", test_df)]:
            results[name] = metrics(df.assign(pred=predict(model, tokenizer, df["text"].tolist())))
            mlflow.log_metrics({f"{name}_{k}": v for k, v in results[name].items()})
        version = registry.log_model(model.merge_and_unload(), tokenizer) if save else None
    del model
    hardware.free_memory()
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
    try:
        return train(params, save=False, run_name=f"trial-{trial.number}")["val"]["f1_macro"]
    except FloatingPointError as exc:  # these settings made training diverge: skip them and keep searching
        hardware.free_memory()
        raise optuna.TrialPruned(str(exc)) from exc


def tune(n_trials=N_TRIALS):
    """Optuna search, each trial a nested MLflow run; the study is kept in optuna.db for analysis.py"""
    registry.setup()
    study = optuna.create_study(study_name=study_name(), storage=STORAGE, direction="maximize", load_if_exists=True,
                                sampler=optuna.samplers.TPESampler(seed=SEED))
    with mlflow.start_run(run_name="tune"):
        study.optimize(objective, n_trials=n_trials)
        finished = [t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE]
        if not finished:
            raise RuntimeError("no Optuna trial finished (every one diverged); see the log above")
        mlflow.log_params({f"best_{k}": v for k, v in study.best_params.items()})
        mlflow.log_metrics({"best_val_f1_macro": study.best_value, "trials_finished": len(finished)})
    return study.best_params


def main(args):
    if args[:1] == ["baseline"] and len(args) == 1:
        return baseline()
    if args in ([], ["lora"]):
        return train()
    if args[:1] == ["tune"] and (len(args) == 1 or (len(args) == 2 and args[1].isdigit())):
        return tune(int(args[1]) if len(args) == 2 else N_TRIALS)
    sys.exit("usage: python -m scripts.train [baseline | lora | tune [N]]")


if __name__ == "__main__":
    setup_logging()
    print(main(sys.argv[1:]))
