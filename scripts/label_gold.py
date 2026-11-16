"""Label the gold set with an LLM: Gemini by default, or a local model through Ollama.

    uv run python -m scripts.label_gold --limit 20                    # try a few first
    uv run python -m scripts.label_gold                               # then the rest (GEMINI_API_KEY in .env)
    uv run python -m scripts.label_gold --ollama                      # a local model instead (qwen2.5:7b by default;
    uv run python -m scripts.label_gold --ollama --model llama3.2:3b  #   start it with `ollama serve`)

We had no time to hand-label the gold set before the deadline, so this is how data/gold.csv was made, mainly by
Gemini 3.5 Flash, with the same guidelines as every LLM label (llm_labels.PROMPT). It fills `label` and `mixed_signal` in data/gold_todo.csv and saves the result to data/gold.csv
after every batch, so a stopped run (Ctrl+C) continues where it left off. Rows that already have a label are never
touched.

Be honest about what this makes: an LLM-labeled ("silver") test set, not hand labels. Every row it labels gets
`labeled_by = <gemini|ollama>:<model>`, and it never fills `label_2`; a person labeling the `shared` rows into `label_2`
gives a real measure of how often the model agrees with a human (`python -m scripts.benchmark`).
"""

import json
import logging
import os
import sys
import time
import urllib.error
import urllib.request

import pandas as pd

from scripts import llm_labels
from scripts.config import GOLD_PATH, GOLD_TODO_PATH, setup_logging

log = logging.getLogger(__name__)
DEFAULT_MODEL = "qwen2.5:7b"  # the Ollama model
BATCH = 10  # small local models lose track of longer lists
PROMPT = llm_labels.PROMPT  # the same guidelines as every other LLM label


def ask_ollama(prompt, model, host=None):
    """one request to the local Ollama server; returns the model's text answer (JSON mode, temperature 0)"""
    host = host or os.getenv("OLLAMA_HOST", "http://localhost:11434")
    body = {"model": model, "messages": [{"role": "user", "content": prompt}], "format": "json",
            "stream": False, "options": {"temperature": 0}}
    request = urllib.request.Request(f"{host}/api/chat", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=900) as response:
            return json.load(response)["message"]["content"]
    except urllib.error.URLError as exc:
        raise RuntimeError(f"can't reach Ollama at {host}; start it with `ollama serve` ({exc})") from exc


def label_batch(rows, ask):
    """{row position in the batch: (label, mixed)}; items the model answers badly are skipped and retried later"""
    try:
        return {i: (label, mixed) for i, label, mixed in llm_labels.parse(ask(PROMPT + llm_labels.items_text(rows)), len(rows))}
    except (json.JSONDecodeError, TypeError) as exc:
        log.warning("skipping a batch the model answered badly: %s", exc)
        return {}


def run(model=DEFAULT_MODEL, limit=None, todo_path=GOLD_TODO_PATH, gold_path=GOLD_PATH, ask=None, provider="ollama",
        batch=BATCH):
    ask = ask or (lambda prompt: ask_ollama(prompt, model))
    source = gold_path if gold_path.exists() else todo_path  # resume from our own output if there is one
    if not source.exists():
        sys.exit("no data/gold_todo.csv; run `uv run python -m scripts.data sample-gold` first")
    gold = pd.read_csv(source, dtype=str, keep_default_na=False)
    if "labeled_by" not in gold:
        gold["labeled_by"] = ["human" if label.strip() else "" for label in gold["label"]]
    todo = gold.index[gold["label"].str.strip() == ""]
    if limit:
        todo = todo[:limit]
    log.info("labeling %d of %d rows with %s", len(todo), len(gold), model)
    started = time.time()
    for n, start in enumerate(range(0, len(todo), batch), 1):
        idx = todo[start:start + batch]
        for i, (label, mixed) in label_batch(gold.loc[idx], ask).items():
            row = idx[i]
            gold.loc[row, ["label", "mixed_signal", "labeled_by"]] = [label, "1" if mixed else "", f"{provider}:{model}"]
        tmp = gold_path.with_suffix(".tmp")
        gold.to_csv(tmp, index=False)
        tmp.replace(gold_path)  # saved every batch, so a stop loses at most one batch
        done = min(start + batch, len(todo))
        per_row = (time.time() - started) / done
        log.info("%d / %d rows (about %.0f min left)", done, len(todo), per_row * (len(todo) - done) / 60)
    left = (gold["label"].str.strip() == "").sum()
    print(f"saved {gold_path}: {len(gold) - left} labeled, {left} still empty"
          + (" (run again to retry them)" if left else ""))
    return gold


if __name__ == "__main__":
    setup_logging()
    args = sys.argv[1:]
    limit = int(args[args.index("--limit") + 1]) if "--limit" in args else None
    if "--ollama" in args:
        run(args[args.index("--model") + 1] if "--model" in args else DEFAULT_MODEL, limit)
    else:
        from scripts.config import LLM_MODEL

        model = os.getenv("LLM_MODEL") or LLM_MODEL
        run(model, limit, ask=lambda prompt: llm_labels.ask(prompt, model), provider="gemini", batch=25)
