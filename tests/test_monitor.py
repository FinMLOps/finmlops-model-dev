import pandas as pd

from scripts import monitor


def test_psi_is_zero_for_the_same_mix_and_large_for_a_shift():
    mix = pd.Series(["AAPL"] * 50 + ["NVDA"] * 50)
    assert monitor.psi(mix, mix) == 0
    assert monitor.psi(mix, pd.Series(["NVDA"] * 95 + ["AAPL"] * 5)) > monitor.DRIFT_PSI


def test_decide_flags_drift_and_decay_only_past_their_thresholds():
    assert monitor.decide({"ticker": 0.05}, {"f1_macro": 0.70}, {"f1_macro": 0.65}) == []
    reasons = monitor.decide({"ticker": 0.5}, {"f1_macro": 0.70}, {"f1_macro": 0.50})
    assert len(reasons) == 2 and "ticker" in reasons[0] and "macro F1" in reasons[1]
    assert monitor.decide({}, None, {"f1_macro": 0.1}) == []  # no held-out score to compare with


def test_windows_never_mix_the_held_out_window_with_new_news(make_news):
    df = make_news([{"published": "2026-10-01"}, {"published": "2026-11-08"}, {"published": "2026-11-14"}])
    train, held_out, new = monitor.windows(df)
    assert [len(train), len(held_out), len(new)] == [1, 1, 1]
    assert new["published"].iloc[0].day == 14
