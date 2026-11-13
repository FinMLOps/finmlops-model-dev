import pandas as pd

from scripts import analysis


def test_charts_are_written(tmp_path):
    df = pd.DataFrame({"label": ["positive", "negative", "neutral"], "pred": ["positive", "neutral", "neutral"]})
    analysis.plot_confusion(df, "challenger", tmp_path)
    old = {"f1_macro": 0.6, "accuracy": 0.7, "precision_macro": 0.6, "recall_macro": 0.6, "accuracy_AAPL": 0.7}
    analysis.plot_compare({"champion": old, "challenger": {**old, "f1_macro": 0.7}}, tmp_path)
    assert {f.name for f in tmp_path.iterdir()} == {"confusion_challenger.png", "compare_overall.png",
                                                    "compare_per_ticker.png"}


def test_compare_skips_charts_with_nothing_to_show(tmp_path):
    analysis.plot_compare({"champion": {"f1_macro": 0.6}}, tmp_path)  # no tickers, no accuracy
    assert [f.name for f in tmp_path.iterdir()] == ["compare_overall.png"]
