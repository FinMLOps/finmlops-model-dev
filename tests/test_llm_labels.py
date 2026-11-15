import json

import pandas as pd
import pytest

from scripts import llm_labels


def fake_llm(answers):
    """an ask() stand-in that returns the given labels, in order, for each item it is asked about"""
    def ask(prompt):
        n = prompt.count("\n") - llm_labels.PROMPT.count("\n") + 1
        return json.dumps([{"i": i, "label": answers[i % len(answers)]} for i in range(n)])
    return ask


def test_label_batch_skips_bad_answers(make_news):
    rows = make_news([{"id": "1"}, {"id": "2"}, {"id": "3"}])
    answer = json.dumps([{"i": 0, "label": "Positive"}, {"i": 1, "label": "bullish"}, {"i": 9, "label": "neutral"}])
    assert llm_labels.label_batch(rows, lambda p: answer) == {0: "positive"}  # unknown label and bad index dropped
    assert llm_labels.label_batch(rows, lambda p: "not json") == {}


def test_run_labels_only_the_training_period_and_resumes(tmp_path, monkeypatch, make_news):
    news = make_news([{"id": "old", "source": "finnhub", "published": "2026-10-20"},
                      {"id": "gap", "source": "finnhub", "published": "2026-11-05 12:00"},  # inside the 24h gap
                      {"id": "test", "source": "finnhub", "published": "2026-11-07"},
                      {"id": "mx", "published": "2026-10-20"}])  # Marketaux has its own labels
    monkeypatch.setattr(llm_labels, "load_news", lambda: news)
    path = tmp_path / "llm.parquet"
    out = llm_labels.run("train", path=path, ask=fake_llm(["negative"]))
    assert out[["id", "label", "split"]].values.tolist() == [["old", "negative", "train"]]
    out = llm_labels.run("train", path=path, ask=lambda p: pytest.fail("already labeled, should not ask again"))
    assert len(out) == 1


def test_agreement_and_gate():
    gold = pd.DataFrame({"id": ["1", "2", "3", "4"], "ticker": "AAPL",
                         "label": ["positive", "negative", "neutral", "positive"]})
    labels = pd.DataFrame({"id": ["1", "2", "3", "4", "9"], "ticker": "AAPL", "split": ["gold"] * 4 + ["train"],
                           "label": ["positive", "negative", "neutral", "neutral", "positive"]})
    out = llm_labels.agreement(gold, labels)
    assert out["rows"] == 4 and out["accuracy"] == 0.75
    assert llm_labels.agreement(gold, labels[labels["split"] == "train"]) == {}
    assert llm_labels.gate(0.4, 0.5) and not llm_labels.gate(0.6, 0.5)  # must beat Marketaux's agreement
    assert not llm_labels.gate(None, 0.5) and llm_labels.gate(None, 0.7)  # else the fixed bar
    assert not llm_labels.gate(0.4, None)  # never measured, never used


def test_ask_needs_a_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        llm_labels.ask("hello")


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode()

    def read(self, *args):
        return self.payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_gemini_gets_only_the_text_and_no_web_tools(monkeypatch):
    sent = {}

    def fake_urlopen(request, timeout):
        sent["body"] = json.loads(request.data)
        return FakeResponse({"candidates": [{"content": {"parts": [{"text": "[]"}]}}]})

    monkeypatch.setenv("GEMINI_API_KEY", "test")
    monkeypatch.setattr(llm_labels.urllib.request, "urlopen", fake_urlopen)
    llm_labels.ask("Apple beats estimates")
    assert "tools" not in sent["body"]  # no Google Search, no URL context
    assert "Use ONLY the text of the item" in llm_labels.PROMPT


def test_an_answer_from_web_search_is_rejected(monkeypatch):
    grounded = {"candidates": [{"content": {"parts": [{"text": "[]"}]}, "groundingMetadata": {"webSearchQueries": ["x"]}}]}
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    monkeypatch.setattr(llm_labels.urllib.request, "urlopen", lambda request, timeout: FakeResponse(grounded))
    with pytest.raises(RuntimeError, match="web search"):
        llm_labels.ask("Apple beats estimates")


def test_the_examples_are_not_real_rows():
    """made-up examples only, so the prompt can never hand the model a gold answer"""
    from scripts.data import load_news
    from scripts.config import DATA_PATH
    if not DATA_PATH.exists():
        pytest.skip("no news.parquet here (CI)")
    titles = set(load_news()["title"].str.lower())
    examples = [line.split("] ", 1)[1].split(" | ")[0].lower()
                for line in llm_labels.PROMPT.splitlines() if line[:2].strip(".").isdigit() and "] " in line]
    assert len(examples) == 8 and not titles & set(examples)


def test_parse_accepts_both_shapes_and_drops_junk():
    assert llm_labels.parse('{"labels": [{"i": 0, "label": "Negative", "mixed": true}]}', 1) == [(0, "negative", True)]
    assert llm_labels.parse('[{"i": 0, "label": "neutral"}, {"i": 5, "label": "neutral"}, {"i": 0}]', 1) == [(0, "neutral", False)]
