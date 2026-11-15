import pandas as pd

from scripts import slices


def frame(n_good=40, n_bad=40, n_tiny=3):
    """Yahoo headlines all right, Benzinga half wrong, and a tiny publisher that is all wrong"""
    rows = [("Yahoo", "positive", "positive")] * n_good + [("Benzinga", "positive", "negative"), ("Benzinga", "neutral", "neutral")] * (n_bad // 2)
    rows += [("Tiny", "positive", "negative")] * n_tiny
    df = pd.DataFrame(rows, columns=["publisher", "label", "pred"])
    return df.assign(ticker="AAPL", source="finnhub", text="x" * 50)


def test_a_lagging_slice_is_flagged_and_tiny_ones_are_ignored(monkeypatch):
    monkeypatch.setattr(slices, "TOP_PUBLISHERS", 10)
    tables, gaps, flagged = slices.analyze(frame())
    assert gaps["publisher"] == 0.5  # Yahoo 1.0 vs Benzinga 0.5; "Tiny" (3 rows, 0.0) is too small to judge
    assert flagged == ["publisher"]
    assert tables["publisher"].loc["Tiny", "rows"] == 3  # still shown in the report


def test_report_writes_the_markdown_and_charts(tmp_path):
    gaps, flagged = slices.report(frame(), "test model", tmp_path)
    report = (tmp_path / "report.md").read_text()
    assert "Slice analysis: test model" in report and "Mitigation" in report
    assert {"ticker.png", "source.png", "publisher.png", "length.png"} <= {f.name for f in tmp_path.iterdir()}
