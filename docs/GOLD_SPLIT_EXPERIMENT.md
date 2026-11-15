# Experiment: training on the gold set's labels

**Question:** can a LoRA fine-tune beat pretrained FinBERT (the champion) on the gold set?

**Short answer:** not with the data we have. Training on gold-style labels removes the loss we saw with Marketaux
labels, but 332 training rows only get the fine-tune level with the champion, not ahead of it.

## Why the normal pipeline can't win

The pipeline trains on Marketaux labels (score cut at ±0.15) and promotes on the gold set (LLM labels). On the 101 gold
rows that have a Marketaux score the two agree at chance level (Cohen's kappa 0.06, and no cut-off does better). The
gold set is 72.5% neutral, the Marketaux training rows are 63% positive. So fine-tuning teaches FinBERT the wrong
labels, and Optuna picks the trial that copies them best:

| Run (all 801 gold rows) | Challenger macro F1 | Champion macro F1 | Gain (95% interval) |
|---|---|---|---|
| default params | 0.353 | 0.395 | −0.043 (−0.075 to −0.012) |
| 10 Optuna trials | 0.349 | 0.395 | −0.046 (−0.081 to −0.012) |

## What we tried

Both settings are off by default, so the normal pipeline is unchanged.

- `GOLD_SPLIT=2026-11-10` trains on the gold rows before the split and compares models only on the rows from it on.
  The gold set is labeled from the same LLMs as before; we only use it differently:
  - **train:** 332 rows, 6–8 Nov (251 neutral, 42 negative, 39 positive)
  - **validation:** 207 rows, 9 Nov (best epoch, Optuna trials); also a one-day gap between training and the eval rows
  - **eval:** 262 rows, 10–11 Nov, never trained or tuned on (199 neutral, 24 negative, 39 positive)
  - rows repeating an eval story (same headline or URL) are dropped from training and validation
- `GOLD_SPLIT_MARKETAUX=1` adds the Marketaux training rows to the gold training rows.
- `CLASS_WEIGHTS=0` turns off the inverse-frequency weights in the loss.

## Results (262 held-out gold rows, 10–11 Nov)

| Run | Macro F1 | Accuracy | F1 neg | F1 neutral | F1 pos | Gain vs champion (95% interval) |
|---|---|---|---|---|---|---|
| champion: pretrained FinBERT | **0.425** | 0.489 | 0.357 | 0.589 | 0.330 | |
| gold rows, default params | 0.421 | 0.454 | 0.381 | 0.524 | 0.357 | −0.005 (−0.036 to +0.028) |
| gold + Marketaux rows | 0.424 | 0.454 | 0.395 | 0.528 | 0.348 | −0.002 (−0.049 to +0.048) |
| gold rows, 10 Optuna trials | 0.414 | 0.454 | 0.348 | 0.534 | 0.359 | −0.012 (−0.039 to +0.017) |
| gold rows, no class weights | 0.418 | **0.718** | 0.340 | **0.830** | 0.083 | −0.008 (−0.091 to +0.072) |
| gold rows, no class weights, Optuna | 0.423 | 0.580 | 0.364 | 0.707 | 0.197 | −0.003 (−0.064 to +0.051) |

Every run fails validation (macro F1 below 0.6), and every interval includes zero: a tie, not a win.

## What it tells us

- **The labels were the problem.** Training on gold-style labels takes the fine-tune from clearly worse (−0.046) to
  level with the champion.
- **The bottleneck now is the amount of data.** 332 rows with 39 positive and 42 negative examples is too little.
  Validation F1 barely moves between epochs and trials (0.37–0.40).
- **Class weights only move errors between classes.** Without them the model learns the neutral majority (accuracy
  0.45 → 0.72, neutral F1 0.52 → 0.83) but stops finding positive news (F1 0.36 → 0.08); macro F1 stays at about 0.42.
  If the team cares more about accuracy than macro F1, the unweighted model is far better than the champion on
  accuracy, but the promotion rule uses macro F1.

## Is the fine-tune still biased?

Yes, but differently. Training on gold-style labels removes the positive bias that came from Marketaux. With class
weights the model then calls too many neutral headlines positive or negative; without them it misses most positive
and negative news. Same 262 eval rows:

**Which label each model leans towards**

| Model | Predicted neg / neutral / pos | Neutral called pos/neg | Pos/neg called neutral | Main problem |
|---|---|---|---|---|
| **true labels** | 9% / 76% / 15% | | | |
| champion: pretrained FinBERT | 34% / 42% / 24% | 54% | 30% | over-reacts, too often negative |
| Marketaux-trained (v3, normal pipeline) | 23% / 23% / **54%** | 74% | 13% | **strong positive bias** |
| gold rows, weighted | 31% / 35% / 34% | 62% | 24% | positive bias gone, still over-reacts |
| gold rows, no class weights | 9% / **88%** / 3% | 11% | 83% | under-reacts: misses positive and negative news |
| gold rows, no class weights, Optuna | 24% / 63% / 12% | 35% | 59% | closest mix, still too negative |

Class weights act as a dial between over-reacting and under-reacting rather than a fix. Every model but the unweighted
one predicts negative far more often than the 9% in the data, which pulls the dashboard's net sentiment down.

**Ticker, publisher and length**

- **Publisher and length gaps are fixed.** The Marketaux-trained model was flagged on publisher (0.25 accuracy gap)
  and length (0.19). The gold-trained models are at 0.03–0.12 on both, except the tuned unweighted one, where length
  is flagged again (0.20).
- **The ticker gap comes from pretrained FinBERT, not from fine-tuning.** Accuracy per ticker:

  | Ticker | Rows | Neutral share | Champion | Gold, weighted | Gold, no weights, Optuna |
  |---|---|---|---|---|---|
  | TSLA | 21 | 62% | 0.24 | 0.29 | 0.43 |
  | AAPL | 35 | 77% | 0.43 | 0.43 | 0.49 |
  | MSFT | 47 | 79% | 0.49 | 0.43 | 0.53 |
  | GOOGL | 40 | 90% | 0.50 | 0.42 | 0.70 |
  | AMZN | 39 | 74% | 0.54 | 0.51 | 0.59 |
  | META | 40 | 72% | 0.55 | 0.55 | 0.65 |
  | NVDA | 40 | 70% | 0.55 | 0.48 | 0.60 |
  | **gap** | | | **0.31** | 0.26 | 0.27 |

  TSLA is worst for every model. Its headlines are the least often neutral (62%), and with 21 rows, just above the
  20-row minimum, the slice is noisy. Fine-tuning narrows the gap slightly rather than causing it.

**What would help:** more positive and negative training examples (39 and 42 today), which the LLM-labeling step
below would supply, and more TSLA eval rows to tell whether its gap is real.

## Which metric decides

We keep **macro F1** as the promotion metric, chosen from how the model is used rather than from which run it favors:

- The dashboard (`frontend/server.py`) shows net sentiment (% positive − % negative) and each day's top positive and
  negative headline. The positive and negative calls are the product; neutral is what's left over.
- **Accuracy rewards doing nothing.** On the 262 eval rows (76% neutral), a model that always says "neutral" gets
  accuracy **0.760**, better than every model above, with macro F1 0.288 and MCC 0.000. The unweighted model's 0.718
  accuracy comes the same way, from labeling almost everything neutral and missing positive news (F1 0.083), which
  would leave the dashboard's net sentiment and top positive headlines nearly empty.
- **Weighted F1** weights each class by its row count, so it is dominated by neutral just like accuracy.
- **Macro F1** averages the three classes' F1 equally, so missing the rare positive and negative headlines costs as
  much as missing neutral ones, which matches what the dashboard needs. MCC or Cohen's kappa would also work (chance-
  corrected, 0 for always-neutral) but are harder to read per class, and the README, the promotion rule and every
  MLflow run already use macro F1.

We did not switch to a metric picked after seeing these results (for example the average of only the positive and
negative F1), since that would make the comparison with the champion meaningless.

## Next step

More training rows labeled like the gold set: run `scripts/llm_labels.py` over the Finnhub training rows with the same
model and prompt as the gold set (needs `GEMINI_API_KEY`), which gives thousands of rows instead of 332. The gate in
`training_data()` blocks LLM training labels while the gold set is itself LLM-labeled; hand-labeling ~100 gold rows
would show whether the Gemini gold labels can be trusted and unblock it.

## Reproduce

Each run below used its own MLflow store and an empty `MODEL_BUCKET`, so nothing touched the shared champion or GCS:

```bash
MODEL_BUCKET= GOLD_SPLIT=2026-11-10 MLFLOW_TRACKING_URI=sqlite:///mlflow_goldsplit.db uv run python -m scripts.pipeline
# add --tune for the Optuna search, GOLD_SPLIT_MARKETAUX=1 or CLASS_WEIGHTS=0 for the other variants
```

Data snapshot `399df0ba`, Apple M4 Pro (MPS, fp32), seed 0.
