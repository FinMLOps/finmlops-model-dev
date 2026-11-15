# Submission checklist: model development

How we built, tuned, tested and chose the sentiment model, and where each part of the course rubric lives. The [README](../README.md) has the overview and the commands.

## Rubric checklist

| Rubric item | Where |
|---|---|
| Load data from the data pipeline | [`scripts/data.py`](../scripts/data.py): `news.parquet` via `dvc import`, pinned in [`data/news.parquet.dvc`](../data/news.parquet.dvc) |
| Train and select the best model | [`scripts/train.py`](../scripts/train.py) (baseline, LoRA, Optuna), [`scripts/pipeline.py`](../scripts/pipeline.py) (selection) |
| Validation on held-out data | [`scripts/evaluate.py`](../scripts/evaluate.py), the frozen benchmark in [`scripts/benchmark.py`](../scripts/benchmark.py), the gold set |
| Bias detection with slicing, report, mitigation | [`scripts/slices.py`](../scripts/slices.py) (Fairlearn), [section below](#slice-analysis-bias-detection) |
| Push to a registry | [`scripts/registry.py`](../scripts/registry.py): MLflow model registry, then a copy to Google Cloud Storage |
| Hyperparameter tuning, documented | [`scripts/train.py`](../scripts/train.py) `objective()` / `tune()`, [search space below](#hyperparameter-tuning) |
| Experiment tracking, charts, model selection | MLflow (every run), [`scripts/analysis.py`](../scripts/analysis.py) (charts), [selection below](#how-a-model-is-chosen) |
| Sensitivity analysis | [`scripts/analysis.py`](../scripts/analysis.py): SHAP, title vs title + summary, Optuna parameter importance |
| CI/CD, validation gate, notifications, rollback | [`.github/workflows/pytest.yml`](../.github/workflows/pytest.yml), [`.github/workflows/train.yml`](../.github/workflows/train.yml), `notify()` in [`scripts/pipeline.py`](../scripts/pipeline.py) |
| Docker | [`Dockerfile`](../Dockerfile) |

## Data and labels

`news.parquet` has 22,163 rows (one per article per ticker) from 1 Oct to 11 Nov 2026: 20,755 from Finnhub and 1,408 from Marketaux. Only Marketaux gives each ticker a sentiment score (-1 to 1); we turn it into a label at ±0.15.

| | Data | Labels | Rows |
|---|---|---|---|
| Training | Marketaux before 5 Nov | Marketaux score | 870 |
| Validation (best epoch, Optuna) | Marketaux, the newest 10% before 5 Nov | Marketaux score | 98 |
| Gap | the 24 hours before the test window | not used | |
| **Test that decides promotion** | **Gold set from 6 to 12 Nov, mostly Finnhub** | Labeled by an LLM, see below | 801 |
| Secondary test | Marketaux, 6 to 12 Nov (frozen benchmark) | Marketaux score | 340 |

Why it's set up this way:

- **Train where the labels are, test where the users are.** 94% of our news, and of what the dashboard shows, is Finnhub (80% from Yahoo), while Marketaux comes from a long tail of other sites. A test made only of Marketaux rows would tell us how well we copy Marketaux's own model on Marketaux-style articles.
- **The model reads the ticker.** Every input starts with `TICKER (Company):`. 38% of Marketaux articles mention more than one ticker, and 138 of them have a different label per ticker, so without the ticker the model would get the same text with two different answers.
- **No leaks.** Split by date with a 24-hour gap, gold rows are never trained on, and any training row repeating a test headline or URL is dropped.

> [!IMPORTANT]
> **The gold set was labeled by an LLM, not by hand.** We ran out of time to hand-label 801 rows, so Gemini (3.5 Flash, with the rest by a second Gemini model when we hit the free quota) labeled them, following written guidelines ([`PROMPT` in `scripts/llm_labels.py`](../scripts/llm_labels.py)). It saw only each row's ticker, headline and summary, with web search off, and was told to ignore anything it knows from elsewhere. Each row records which model labeled it (`labeled_by` in `data/gold.csv`). The 120 rows marked `shared` are there to check the LLM against people: a person labels them into `label_2` without looking at the LLM's label, and `python -m scripts.benchmark` reports how often they agree. *(Fill in: how many shared rows were hand-checked, and the agreement, in [results](#results).)*

While checking samples we found Marketaux often tags a ticker on articles that aren't about that company (a Rivian story tagged TSLA, a crypto story tagged NVDA) and still scores them positive. That noise is in our training labels too, and is one reason we don't use Marketaux to decide promotion.

## The model and training

- **Base:** [ProsusAI/finbert](https://huggingface.co/ProsusAI/finbert), pinned to one Hugging Face commit so the baseline can't change under us. Pretrained FinBERT is the first champion.
- **Fine-tuning:** [LoRA](https://huggingface.co/docs/peft) adapters on the attention query and value layers; only those and the classifier head train.
- **Loss:** cross-entropy weighted by inverse class frequency, because the labels are mostly positive.
- **Optimizer:** AdamW with weight decay 0.01, a 10% learning-rate warmup then linear decay, and gradient clipping at 1.0.
- **Best epoch:** after every epoch we score the validation set and keep the weights of the best epoch.
- **Hardware:** NVIDIA GPU with mixed precision (bf16 on newer cards, fp16 on older ones), Apple Silicon GPU, or CPU, picked automatically ([`scripts/hardware.py`](../scripts/hardware.py)).

## Hyperparameter tuning

[Optuna](https://optuna.org) with its default Bayesian sampler (TPE, seed 0), 10 trials, each one a nested MLflow run. A trial is scored by macro F1 on the **validation** set, never the test set. A trial whose loss becomes NaN is pruned and the search carries on.

| Hyperparameter | Search space |
|---|---|
| Learning rate | 1e-5 to 5e-4, log scale |
| LoRA rank `r` | 4, 8, 16 |
| LoRA alpha | 8, 16, 32 |
| LoRA dropout | 0.0 to 0.3 |
| Epochs | 2 to 4 |

Batch size (16), max length (256 tokens), weight decay, warmup and clipping stay fixed. There's one Optuna study per data snapshot and label cut-off, so trials on old data never mix with new ones. Which hyperparameters mattered most comes from Optuna's parameter importance ([`scripts/analysis.py`](../scripts/analysis.py)).

## How a model is chosen

Every run is tracked in MLflow: hyperparameters, the data snapshot, label cut-off and gap, which labels were used, the hardware, the loss and validation F1 for every epoch, and the final validation and test metrics. Each trained model is registered as a new version; the live one has the `champion` alias.

A challenger replaces the champion only if all of these hold ([`decide()`](../scripts/pipeline.py)):

1. **Validation:** macro F1 of at least 0.60 on the test set that decides promotion, or the run fails (and CI goes red).
2. **A real improvement:** the macro F1 gain must stay above zero across a 95% confidence interval. We resample the test rows 1,000 times and score both models on each resample (a paired bootstrap). With a few hundred rows, a gain of a couple of points can easily be luck.
3. **No ticker left behind:** not worse than the champion for any ticker (0.02 allowed, since some tickers have few rows).

If it passes, the model is copied to Google Cloud Storage and only then gets the `champion` alias. If it fails, the champion simply stays (rollback). Either way the team gets an email, and the MLflow "select" run keeps the decision, both models' metrics, the confidence interval, the charts and the slice report.

## Slice analysis (bias detection)

Our data has no people in it, so "bias" here means: does the model work equally well for every **ticker**, **source** (Finnhub or Marketaux), **publisher**, **headline length**, and (on the gold set) **mixed-signal** headline? A model that's great on Yahoo headlines and poor on everything else, or good for NVDA and bad for META, would mislead exactly the users who care about those.

[`scripts/slices.py`](../scripts/slices.py) uses [Fairlearn](https://fairlearn.org)'s `MetricFrame` to compute accuracy, macro F1 and row counts per slice for every challenger. A slice needs at least 20 rows to be judged, and a gap above 0.15 accuracy between the best and worst slice is flagged. The report (`report.md` plus one chart per slice) goes to MLflow, and a flagged slice adds a warning to the email. It warns rather than blocks: the per-ticker rule above already blocks a model that is worse for any ticker.

**Mitigation.**

- **Already in place: re-weighting.** The class-weighted loss stops the model from ignoring the rare negative and neutral labels.
- **Already in place: per-ticker protection.** The promotion rule refuses a model that gets worse for any ticker.
- **If a slice is flagged:** hand-label more rows for that slice and add them to training, or oversample it (re-sampling).
- **Trade-off:** pushing one slice up can cost a little overall macro F1, so we only act when a gap is both large (> 0.15) and on enough rows (≥ 20).

## Sensitivity analysis

[`scripts/analysis.py`](../scripts/analysis.py), run on the champion:

- **Words (SHAP):** which words push headlines toward positive or negative, as charts and an example page.
- **Input fields:** macro F1 on the headline alone vs headline + summary, to see whether the summary helps.
- **Hyperparameters:** Optuna's importance of each searched hyperparameter.

## CI/CD

- [`pytest.yml`](../.github/workflows/pytest.yml) runs the offline tests (no downloads, no API calls) on every push and pull request to `main`, and emails the team if they fail.
- [`train.yml`](../.github/workflows/train.yml) runs the tests, then the whole pipeline, whenever model code, the data snapshot or the gold set changes on `main`, or by hand (optionally with the Optuna search). It uploads the charts, reports and MLflow record as build artifacts. It needs a Google Cloud service account (`GCP_SA_KEY`) to pull the data with DVC; until that secret exists, it skips training with a notice instead of failing.
- [`Dockerfile`](../Dockerfile) packages the pipeline with the same Python and locked packages, CPU PyTorch.

## Results

> [!NOTE]
> Fill in after running `uv run python -m scripts.pipeline` (and `--tune`) and `uv run python -m scripts.analysis`. The charts are in `outputs/` and in the MLflow runs.

| Model | Macro F1 (gold) | Accuracy (gold) | Macro F1 (benchmark) | Decision |
|---|---|---|---|---|
| Pretrained FinBERT (v1) | | | | first champion |
| LoRA, default params | | | | |
| LoRA, best Optuna params | | | | |

| Agreement (Cohen's kappa) | Rows | Kappa |
|---|---|---|
| Gemini vs a person (shared rows: `label` vs `label_2`) | | |
| Marketaux vs the gold labels (Marketaux rows of the gold set) | | |
