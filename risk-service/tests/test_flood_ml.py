"""Flood climatology: DFO labelling (radius, multi-week events, severity), the activity ratio's use of past years only,
and Factor 6 reporting floods alongside cyclones."""
from datetime import datetime, timedelta, timezone

import geopandas as gpd
import numpy as np
import pandas as pd
import pytest
import shapely

from app.ml.datasets import floods
from app.ml.training import tune_climatology as tune
from tests.conftest import ctx, history
from tests.test_cyclone_ml import flat_climatology


def events(rows):
    return gpd.GeoDataFrame([{"ID": i, "began": pd.Timestamp(a), "ended": pd.Timestamp(b), "SEVERITY": s, "geometry": g}
                             for i, (a, b, s, g) in enumerate(rows, 1)], geometry="geometry", crs="EPSG:4326")


GRID = pd.DataFrame({"cell": [0, 1], "lat": [50.0, 50.0], "lon": [7.0, 11.0], "coast_km": [100.0, 100.0]})


def test_an_outline_near_but_not_over_a_cell_centre_still_counts():
    # 0.5 x 0.5 degree outline whose edge is ~0.08 degrees (~6 km) from cell 0 — like the Ahr flood, July 2021
    near = shapely.box(6.4, 50.1, 6.92, 50.6)
    far = shapely.box(9.0, 50.1, 9.5, 50.6)                         # ~100+ km from both cells
    pos = floods.label_windows(events([("2021-07-14", "2021-07-19", 2.0, near),
                                       ("2021-07-14", "2021-07-19", 1.0, far)]), GRID, 2000)
    assert set(pos["cell"]) == {0}                                 # Wed 14 – Mon 19 July: two weekly windows
    assert len(pos) == 2 and pos["y_severe"].tolist() == [1, 1]


def test_a_long_flood_marks_every_week_it_overlaps():
    start = floods.window_start(100)                                # a Monday
    poly = shapely.box(6.5, 49.5, 7.5, 50.5)                        # covers cell 0
    pos = floods.label_windows(events([(start + pd.Timedelta(days=5), start + pd.Timedelta(days=16), 1.0, poly)]),
                               GRID, 2000)
    assert pos["window"].tolist() == [100, 101, 102]               # Sat of week 100 to Wed of week 102
    assert pos["y_severe"].sum() == 0


def test_events_outside_the_study_period_are_dropped():
    poly = shapely.box(6.5, 49.5, 7.5, 50.5)
    pos = floods.label_windows(events([("1984-12-01", "1984-12-20", 1.0, poly),
                                       (str(floods.window_start(10).date()), str(floods.window_start(10).date()), 1.0, poly)]),
                               GRID, 11)
    assert pos["window"].tolist() == [10]


def test_activity_ratio_uses_only_years_before_the_target():
    rate = np.array([1.0, 1.0, 1.0, 1.0, 1.0, 3.0, 9.0])
    r = tune.activity_ratio(rate, np.array([5, 6]), np.arange(5))
    assert r[0] == pytest.approx(1.0)                              # year 5 sees years 0-4 only, not its own 3.0
    assert r[1] == pytest.approx((1 + 1 + 1 + 1 + 3) / 5)          # year 6 sees years 1-5, not its own 9.0


def test_history_factor_reports_flood_and_cyclone_probabilities():
    from app.risk_engine.factors import historical_incident_risk as f6
    h = history()
    h.cyclone_climatology = flat_climatology(0.02)
    h.flood_climatology = flat_climatology(0.05)
    start = datetime(2027, 8, 1, tzinfo=timezone.utc)
    f = f6.compute(ctx(mode="journey", window_start=start, window_end=start + timedelta(days=7), history=h))
    assert f.inputs["flood"]["p_period"] == pytest.approx(0.05, rel=1e-3)
    assert f.inputs["cyclone"]["p_period"] == pytest.approx(0.02, rel=1e-3)
    assert ("Flood history 1980–2026: 5.0% chance of a large flood affecting the area within 100 km during the trip "
            "(01 Aug–08 Aug 2027, 7 days)") in f.explanation
    assert any(n.startswith("Flood probability:") and "non-commercial" in n for n in f.data_quality.notes)
    base = f6.compute(ctx(history=history()))
    assert f.severity_class == base.severity_class and f.value == base.value


def test_flood_probability_survives_failed_history_providers_and_missing_artefact_is_explained():
    from app.risk_engine.factors import historical_incident_risk as f6
    h = history(events=None)
    h.flood_climatology = flat_climatology(0.05)
    f = f6.compute(ctx(history=h))
    assert f.status == "unavailable" and f.value is None
    assert set(f.inputs) == {"flood", "climatology_unavailable"} and "Flood history" in f.explanation
    assert f.inputs["climatology_unavailable"] == {"cyclone": "cyclone climatology not built (see docs/ML.md)"}
    assert any("No cyclone probability: cyclone climatology not built" in n for n in f.data_quality.notes)


def test_outlook_carries_a_monthly_profile_for_the_season_chart():
    from app.risk_engine.factors import historical_incident_risk as f6
    h = history()
    k = np.tile(np.zeros(52), (1, 1))
    k[0, 26:31] = 40 * 0.3                                          # storms only in weeks 26-30 (July)
    h.flood_climatology = flat_climatology(cells=((34.9986, 135.785),), k=k)
    f = f6.compute(ctx(history=h))
    monthly = f.inputs["flood"]["monthly_p_week"]
    assert len(monthly) == 12
    assert monthly.index(max(monthly)) == 6                        # July is the peak month
    assert monthly[0] == pytest.approx(0, abs=1e-3)                # January quiet
