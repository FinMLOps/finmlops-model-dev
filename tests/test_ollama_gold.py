import json

import pandas as pd

from scripts import ollama_gold


def fake_model(label="negative"):
    def ask(prompt):
        n = prompt.count("\n") - ollama_gold.PROMPT.count("\n") + 1
        return json.dumps({"labels": [{"i": i, "label": label, "mixed": i == 0} for i in range(n)]})
    return ask


def todo_file(tmp_path, labels):
    path = tmp_path / "gold_todo.csv"
    pd.DataFrame({"id": [str(i) for i in range(len(labels))], "ticker": "AAPL", "title": "t", "summary": "s",
                  "shared": "", "label": labels, "label_2": "", "mixed_signal": ""}).to_csv(path, index=False)
    return path


def test_fills_empty_labels_and_never_touches_human_ones(tmp_path):
    todo, gold = todo_file(tmp_path, ["positive", "", ""]), tmp_path / "gold.csv"
    out = ollama_gold.run("m", todo_path=todo, gold_path=gold, ask=fake_model())
    assert out["label"].tolist() == ["positive", "negative", "negative"]
    assert out["labeled_by"].tolist() == ["human", "ollama:m", "ollama:m"]
    assert out["mixed_signal"].tolist()[1] == "1"


def test_resumes_from_its_own_output(tmp_path):
    todo, gold = todo_file(tmp_path, [""] * 4), tmp_path / "gold.csv"
    ollama_gold.run("m", limit=2, todo_path=todo, gold_path=gold, ask=fake_model("neutral"))
    out = ollama_gold.run("m", todo_path=todo, gold_path=gold, ask=fake_model("positive"))
    assert out["label"].tolist() == ["neutral", "neutral", "positive", "positive"]


def test_bad_answers_are_skipped():
    rows = pd.DataFrame({"ticker": ["AAPL", "AAPL"], "title": "t", "summary": "s"})
    answer = json.dumps({"labels": [{"i": 0, "label": "Bullish"}, {"i": 1, "label": "Neutral"}, {"i": 7, "label": "neutral"}]})
    assert ollama_gold.label_batch(rows, lambda p: answer) == {1: ("neutral", False)}
    assert ollama_gold.label_batch(rows, lambda p: "oops") == {}


def test_gemini_rows_are_marked_as_such(tmp_path):
    todo, gold = todo_file(tmp_path, [""] * 3), tmp_path / "gold.csv"
    out = ollama_gold.run("gemini-x", todo_path=todo, gold_path=gold, ask=fake_model(), provider="gemini", batch=25)
    assert set(out["labeled_by"]) == {"gemini:gemini-x"}
