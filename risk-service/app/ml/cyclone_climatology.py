"""Cyclone climatology: P(>= 34 kt cyclone within 100 km of a place during a 7-day window), from IBTrACS.

Estimate at a point for week-of-year w (all smoothed +-2 weeks):
    k = kernel-weighted count of positive windows near the point (sigma LOCAL_SIGMA_KM)
    n = number of windows observed for that week across the years
    prior = regional frequency (sigma = prior_sigma_km)
    p = (k + m * prior) / (n + m)           empirical-Bayes shrinkage towards the region, m in years
A place with no storms on record but storms in its region gets a small, non-zero probability; a place with a long
record keeps its own. `m` and `prior_sigma_km` are chosen on validation years (training/tune_cyclone_climatology.py)
and the result was then tested once on later years (docs/ML.md).

Domain: within 3 * LOCAL_SIGMA_KM of a grid cell (45 S - 45 N, land and 200 km of coast). Outside it the estimate is
None, never 0, because no data were used there.
"""
from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

from app.ml.preprocessing.cyclone_features import WEEKS, apply_kernel, kernel_weights, smooth_weeks, week_of_year

log = logging.getLogger("risk.cyclone")
LOCAL_SIGMA_KM = 75.0
ARTEFACT = "cyclone_climatology.npz"
META = "cyclone_climatology.json"


def tables(counts: np.ndarray, nwin: np.ndarray, year_idx) -> tuple[np.ndarray, np.ndarray]:
    """Smoothed positives per (cell, week) and windows per week, summed over the selected years."""
    return smooth_weeks(counts[:, :, year_idx].sum(2)), smooth_weeks(nwin[None, :, year_idx].sum(2))[0]


def estimate(grid: pd.DataFrame, k_cells: np.ndarray, n_weeks: np.ndarray, lat, lon, m: float,
             prior_sigma_km: float) -> np.ndarray:
    """p[point, week] for query points; NaN outside the domain."""
    lat, lon = np.atleast_1d(lat), np.atleast_1d(lon)
    k = apply_kernel(kernel_weights(grid, lat, lon, LOCAL_SIGMA_KM), k_cells)                 # points x weeks
    if m <= 0:
        return k / n_weeks
    prior = apply_kernel(kernel_weights(grid, lat, lon, prior_sigma_km), k_cells / n_weeks)
    prior = np.where(np.isnan(prior), 0.0, prior)
    return (k + m * prior) / (n_weeks + m)


@dataclass
class Climatology:
    grid: pd.DataFrame
    k_cells: np.ndarray
    n_weeks: np.ndarray
    m: float
    prior_sigma_km: float
    meta: dict

    def weekly(self, lat: float, lon: float) -> np.ndarray | None:
        """52 weekly probabilities for the point, or None outside the domain."""
        p = estimate(self.grid, self.k_cells, self.n_weeks, lat, lon, self.m, self.prior_sigma_km)[0]
        return None if np.isnan(p).all() else np.clip(p, 0, 1)

    def period(self, lat: float, lon: float, start: datetime, end: datetime) -> dict | None:
        """P(at least one) over [start, end], treating weeks as independent; also the annual rate."""
        p = self.weekly(lat, lon)
        if p is None:
            return None
        days = max((end - start).total_seconds() / 86400, 1.0)
        log_none, t = 0.0, start
        remaining = days
        while remaining > 1e-9:
            step = min(7.0, remaining)
            w = int(week_of_year(pd.DatetimeIndex([t]))[0])
            log_none += (step / 7) * math.log1p(-min(float(p[w]), 0.999999))
            t += timedelta(days=step)
            remaining -= step
        annual_rate = float(-np.log1p(-np.minimum(p, 0.999999)).sum() * 365.25 / 7 / WEEKS)
        peak = int(np.argmax(p))
        return {"p_period": 1 - math.exp(log_none), "period_days": round(days, 2),
                "p_week": float(p[int(week_of_year(pd.DatetimeIndex([start]))[0])]),
                "annual_rate": annual_rate, "peak_week_start": (datetime(2001, 1, 1) + timedelta(weeks=peak)).strftime("%d %b"),
                "p_peak_week": float(p[peak])}


def save(path: Path, grid: pd.DataFrame, k_cells, n_weeks, m: float, prior_sigma_km: float, meta: dict) -> None:
    path.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path / ARTEFACT, lat=grid["lat"].to_numpy(), lon=grid["lon"].to_numpy(),
                        k_cells=k_cells, n_weeks=n_weeks)
    (path / META).write_text(json.dumps({**meta, "m": m, "prior_sigma_km": prior_sigma_km,
                                         "local_sigma_km": LOCAL_SIGMA_KM}, indent=1, default=str))


@lru_cache
def load(model_dir: str) -> Climatology | None:
    d = Path(model_dir)
    if not (d / ARTEFACT).exists() or not (d / META).exists():
        return None
    try:
        z = np.load(d / ARTEFACT)
        meta = json.loads((d / META).read_text())
        grid = pd.DataFrame({"lat": z["lat"], "lon": z["lon"]})
        return Climatology(grid, z["k_cells"], z["n_weeks"], meta["m"], meta["prior_sigma_km"], meta)
    except Exception as e:  # noqa: BLE001
        log.warning("could not load cyclone climatology: %s", e)
        return None
