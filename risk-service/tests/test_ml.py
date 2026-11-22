"""ML pipeline pieces that must hold regardless of the trained artefact: feature parity between training and
inference, no look-ahead, dataset validation, metric computation."""
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from app.ml.datasets.validate import validate
from app.ml.evaluation.metrics import best_f1_threshold, evaluate
from app.ml.preprocessing.features import FEATURES, features_frame, features_from_daily


def daily(n=20, lat=10.0):
    d0 = date(2024, 1, 1)
    rng = np.random.default_rng(0)
    return pd.DataFrame({"location_id": "L", "latitude": lat, "longitude": 1.0,
                         "date": [d0 + timedelta(days=i) for i in range(n)],
                         "precip": rng.gamma(1, 5, n).round(1), "gust": rng.uniform(5, 25, n).round(1),
                         "tmax": rng.uniform(25, 33, n).round(1), "tmin": rng.uniform(18, 24, n).round(1),
                         "y": 0, "y_red": 0})


def test_training_and_inference_features_identical():
    df = daily()
    frame = features_frame(df).set_index("date")
    day = df["date"].iloc[12]
    as_dict = lambda col: {d.isoformat(): v for d, v in zip(df["date"], df[col])}
    live = features_from_daily(day, as_dict("precip"), as_dict("gust"), as_dict("tmax"), as_dict("tmin"), 10.0)
    for f in FEATURES:
        assert live[f] == pytest.approx(frame.loc[day, f], abs=1e-9), f


def test_features_never_look_ahead():
    df = daily()
    base = features_frame(df).set_index("date")
    future = df.copy()
    future.loc[15:, "precip"] = 999.0  # change only days after day 12
    changed = features_frame(future).set_index("date")
    day = df["date"].iloc[12]
    assert base.loc[day, FEATURES].equals(changed.loc[day, FEATURES])


def test_incomplete_history_gives_no_features():
    df = daily(5)
    d = {x.isoformat(): v for x, v in zip(df["date"], df["precip"])}
    assert features_from_daily(df["date"].iloc[4], d, d, d, d, 10.0) is None


def test_dataset_validation_catches_problems():
    df = daily(100)
    assert "too few" in " ".join(validate(df)["hard_failures"])
    df.loc[:60, "y"] = 1
    df.loc[0, "y_red"] = 1
    ok = validate(df)
    assert ok["hard_failures"] == [] and ok["positives"] == 61
    bad = pd.concat([df, df.iloc[:3]])
    assert any("duplicate" in m for m in validate(bad)["hard_failures"])


def test_metrics():
    y = np.array([0, 0, 0, 1, 1, 0, 1, 0])
    s = np.array([.1, .2, .7, .9, .8, .1, .3, .2])
    red = np.array([0, 0, 0, 1, 0, 0, 1, 0])
    m = evaluate(y, s, 0.5, red)
    assert m["confusion_matrix"] == {"tn": 4, "fp": 1, "fn": 1, "tp": 2}
    assert m["precision"] == pytest.approx(2 / 3, abs=1e-4) and m["recall"] == pytest.approx(2 / 3, abs=1e-4)
    assert m["false_positive_rate"] == pytest.approx(0.2) and m["high_risk_recall"] == 0.5
    assert 0 < best_f1_threshold(y, s) <= 0.9


def test_evaluation_gate_withholds_weak_models():
    from app.ml.inference.predictor import gate
    weak = {"metrics": {"test": {"pr_auc": 0.044, "prevalence": 0.022, "recall": 0.06}}}
    strong = {"metrics": {"test": {"pr_auc": 0.30, "prevalence": 0.022, "recall": 0.62}}}
    assert gate(weak)[0] is False and "2.0x prevalence" in gate(weak)[1]
    assert gate(strong)[0] is True
