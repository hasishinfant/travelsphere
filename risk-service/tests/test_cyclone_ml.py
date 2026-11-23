"""Cyclone-exposure pipeline: track interpolation, radius labelling, window indexing, ENSO lag and the
leave-one-year-out climatology that keeps a training row from seeing its own label."""
import numpy as np
import pandas as pd
import pytest

from app.ml.datasets.cyclones import ORIGIN, interpolate_hourly, label_windows, load_oni, window_start
from app.ml.preprocessing.cyclone_features import oni_lag2, smooth_weeks, week_of_year
from app.ml.training import train_cyclone as tc


def track(sid, fixes):
    return pd.DataFrame({"sid": sid, "time": pd.to_datetime([t for t, *_ in fixes]),
                         "lat": [a for _, a, _, _ in fixes], "lon": [b for _, _, b, _ in fixes],
                         "wind_kt": [w for *_, w in fixes]})


def test_hourly_interpolation_crosses_the_dateline_the_short_way():
    t = track("A", [("2020-01-06 00:00", 10.0, 179.0, 50), ("2020-01-06 06:00", 10.0, -179.0, 60)])
    h = interpolate_hourly(t)
    assert len(h) == 7
    assert h["lon"].abs().min() >= 179.0 - 1e-9          # never sweeps back across 0 degrees
    assert h["wind_kt"].tolist()[3] == pytest.approx(55)


def test_labels_use_the_radius_wind_threshold_and_weekly_windows():
    grid = pd.DataFrame({"cell": [0, 1, 2], "lat": [20.0, 20.0, 20.0], "lon": [0.0, 0.85, 3.0], "coast_km": 0.0})
    monday = ORIGIN + pd.Timedelta(weeks=10)
    t = pd.concat([
        track("S", [(monday + pd.Timedelta(hours=12), 20.0, 0.0, 70)]),            # 0 km from cell 0, ~89 km from cell 1
        track("W", [(monday + pd.Timedelta(days=8), 20.0, 3.0, 30)]),              # too weak for cell 2
    ])
    pos = label_windows(t, grid)
    assert sorted(pos["cell"]) == [0, 1]
    assert set(pos["window"]) == {10}
    assert pos.set_index("cell").loc[0, "y64"] == 1
    assert window_start(10) == monday


def test_enso_is_taken_from_two_months_before_the_trip(tmp_path):
    f = tmp_path / "oni.txt"
    f.write_text(" SEAS  YR   TOTAL   ANOM\n  DJF 2020  27.0  0.5\n  JFM 2020  27.1  0.6\n  FMA 2020  27.2  0.7\n")
    oni = load_oni(f)
    assert oni[pd.Period("2020-02", "M")] == 0.6
    assert oni_lag2(pd.DatetimeIndex(["2020-04-15"]), oni)[0] == 0.6      # April trip uses the JFM value
    assert np.isnan(oni_lag2(pd.DatetimeIndex(["2020-06-01"]), oni)[0])   # not published yet -> missing, not guessed


def test_week_smoothing_wraps_around_new_year_and_keeps_totals():
    a = np.zeros((1, 52))
    a[0, 0] = 9
    s = smooth_weeks(a)
    assert s[0, 51] == pytest.approx(2) and s[0, 50] == pytest.approx(1) and s.sum() == pytest.approx(9)
    assert week_of_year(pd.DatetimeIndex(["2021-12-31"]))[0] == 51


def test_training_climatology_never_contains_the_rows_own_year(monkeypatch):
    # One cell; a storm in the same week of every training year except one
    monkeypatch.setattr(tc, "TRAIN_END", 1983)
    grid = pd.DataFrame({"cell": [0], "lat": [15.0], "lon": [120.0], "coast_km": [10.0]})
    n_windows = 52 * 5
    starts = window_start(np.arange(n_windows))
    target = [w for w in range(n_windows) if week_of_year(starts[[w]])[0] == 30 and starts[w].year in (1980, 1981, 1982)]
    pos = pd.DataFrame({"cell": 0, "window": target, "y64": 0})
    counts, nwin, y0 = tc.count_tables(grid, pos, n_windows)
    oni = pd.Series(0.0, index=pd.period_range("1979-01", "1985-12", freq="M"))
    df = tc.frame(grid, pos, n_windows, oni, counts, nwin, y0)
    wk = df[week_of_year(window_start(df["window"])) == 30].set_index("year")
    peak = 3 / 9                              # +-2 week smoothing keeps 3/9 of a storm-week in its own week
    # 1980 row sees only 1981-1983 (2 storms in 3 years); 1983 sees 1980-1982 (3 in 3)
    assert wk.loc[1980, "clim_local"] == pytest.approx(2 / 3 * peak, rel=0.05)
    assert wk.loc[1983, "clim_local"] == pytest.approx(3 / 3 * peak, rel=0.05)
    # after the training period every row uses all training years (3 storms in 4 years)
    assert wk.loc[1984, "clim_local"] == pytest.approx(3 / 4 * peak, rel=0.05)


def test_reliability_bins_and_calibration_error():
    y = np.array([0, 0, 0, 1] * 25)
    rows, ece = tc.reliability(y, np.full(100, 0.25))
    assert rows == [{"predicted": 0.25, "observed": 0.25, "n": 100}] and ece == 0
