"""Cyclone-exposure pipeline: track interpolation, radius labelling, window indexing, ENSO lag and the
leave-one-year-out climatology that keeps a training row from seeing its own label."""
from datetime import timedelta

import numpy as np
import pandas as pd
import pytest

from app.ml.datasets.cyclones import ORIGIN, interpolate_hourly, label_windows, load_oni, window_start
from app.ml.preprocessing.cyclone_features import oni_lag2, smooth_weeks, week_of_year
from app.ml.training import train_cyclone as tc
from tests.conftest import NOW, ctx, history


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


def flat_climatology(p=0.02, cells=((34.9986, 135.785),), m=0.0, sigma=300.0, k=None):
    from app.ml.hazard_climatology import Climatology
    grid = pd.DataFrame({"lat": [a for a, _ in cells], "lon": [b for _, b in cells]})
    n = np.full(52, 40.0)
    k_cells = np.tile(n * p, (len(cells), 1)) if k is None else np.asarray(k, float)
    return Climatology(grid, k_cells, n, m, sigma, {"years": [1980, 2026]})


def test_climatology_shrinks_a_storm_free_place_towards_its_region():
    from app.ml.hazard_climatology import estimate
    # cell A (no storms on record) next to cell B (storms in 10 % of weeks), 220 km apart
    grid = pd.DataFrame({"lat": [20.0, 22.0], "lon": [120.0, 120.0]})
    n = np.full(52, 40.0)
    k = np.vstack([np.zeros(52), n * 0.1])
    raw = estimate(grid, k, n, [20.0], [120.0], m=0, prior_sigma_km=300)[0, 0]
    shrunk = estimate(grid, k, n, [20.0], [120.0], m=40, prior_sigma_km=300)[0, 0]
    assert raw == pytest.approx(0.1 * 0.0125 / 1.0125, rel=0.05)   # own kernel gives B ~1 % weight at 222 km
    assert 0.01 < shrunk < 0.1                      # pulled part of the way towards the region
    assert np.isnan(estimate(grid, k, n, [60.0], [0.0], m=40, prior_sigma_km=300)).all()   # far away: no data, not 0


def test_trip_probability_combines_weeks_and_outside_the_area_is_none():
    c = flat_climatology(0.02)
    two_weeks = c.period(34.9986, 135.785, NOW, NOW + timedelta(days=14))
    assert two_weeks["p_period"] == pytest.approx(1 - 0.98 ** 2, rel=1e-6)
    assert two_weeks["annual_rate"] == pytest.approx(-np.log(0.98) * 365.25 / 7, rel=1e-6)
    short = c.period(34.9986, 135.785, NOW, NOW + timedelta(hours=6))
    assert short["p_period"] == pytest.approx(1 - 0.98 ** (1 / 7), rel=1e-6)    # at least one day is counted
    assert c.period(48.86, 2.35, NOW, NOW + timedelta(days=7)) is None


def test_history_factor_reports_cyclone_probability_without_changing_its_class():
    from app.risk_engine.factors import historical_incident_risk as f6
    base = f6.compute(ctx(history=history()))
    h = history()
    h.cyclone_climatology = flat_climatology(0.02)
    f = f6.compute(ctx(history=h))
    assert f.severity_class == base.severity_class and f.value == base.value
    assert f.inputs["cyclone"]["p_period"] == pytest.approx(0.02, rel=1e-3)        # destination: next 7 days
    assert "2.0% chance of a tropical storm or stronger passing within 100 km during the next 7 days" in f.explanation
    assert "1980–2026" in f.explanation
    assert any("No cyclone probability: cyclone climatology not built" in n for n in base.data_quality.notes)


def test_future_journey_is_described_by_its_dates_not_as_the_next_7_days():
    from datetime import datetime, timezone
    from app.risk_engine.factors import historical_incident_risk as f6
    h = history()
    h.cyclone_climatology = flat_climatology(0.02)
    start = datetime(2027, 8, 1, tzinfo=timezone.utc)                      # assessed months ahead (NOW is Nov 2026)
    f = f6.compute(ctx(mode="journey", window_start=start, window_end=start + timedelta(days=7), history=h))
    assert "next 7 days" not in f.explanation
    assert "during the trip (01 Aug–08 Aug 2027, 7 days)" in f.explanation
    assert f.inputs["cyclone"]["scope"] == "journey" and f.inputs["cyclone"]["period_start"].startswith("2027-08-01")
    across = f6.compute(ctx(mode="journey", window_start=datetime(2027, 12, 28, tzinfo=timezone.utc),
                            window_end=datetime(2028, 1, 3, tzinfo=timezone.utc), history=h))
    assert "(28 Dec 2027–03 Jan 2028, 6 days)" in across.explanation


def test_cyclone_probability_is_reported_when_history_providers_fail():
    from app.risk_engine.factors import historical_incident_risk as f6
    h = history(events=None)
    h.cyclone_climatology = flat_climatology(0.02)
    f = f6.compute(ctx(history=h))
    assert f.status == "unavailable" and f.value is None and f.severity_class is None
    assert f.inputs["cyclone"]["p_period"] == pytest.approx(0.02, rel=1e-3)
    assert f.explanation.startswith("Historical hazard records unavailable")
    assert "2.0% chance of a tropical storm or stronger" in f.explanation
    assert any(n.startswith("Cyclone probability:") for n in f.data_quality.notes)
    # without a climatology the unavailable result is as before, and says why
    plain = f6.compute(ctx(history=history(events=None)))
    assert plain.inputs == {} and any("not built" in n for n in plain.data_quality.notes)


def test_history_factor_says_when_a_place_is_outside_the_cyclone_area():
    from app.risk_engine.factors import historical_incident_risk as f6
    h = history()
    h.cyclone_climatology = flat_climatology(0.02, cells=((10.0, 100.0),))
    f = f6.compute(ctx(history=h))
    assert f.inputs["cyclone"] is None
    assert any("outside the cyclone climatology's area" in n for n in f.data_quality.notes)


def test_time_factor_quotes_the_local_weekly_probability_in_season():
    from app.risk_engine.factors import activity_timing as time_factor
    h = history()
    h.cyclone_climatology = flat_climatology(0.05)
    f = time_factor.compute(ctx(history=h))           # Kyoto, 22 Nov: inside the W N Pacific season
    assert "passed within 100 km in 5.0% of weeks at this time of year (1980–2026)" in f.explanation
    assert f.inputs["cyclone_p_week"] == pytest.approx(0.05)


def test_reliability_bins_and_calibration_error():
    y = np.array([0, 0, 0, 1] * 25)
    rows, ece = tc.reliability(y, np.full(100, 0.25))
    assert rows == [{"predicted": 0.25, "observed": 0.25, "n": 100}] and ece == 0
