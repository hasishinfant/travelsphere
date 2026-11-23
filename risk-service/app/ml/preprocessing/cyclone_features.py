"""Features for the cyclone-exposure model, shared by training and inference.

Every feature is known before the trip window starts:
  lat, lon (sin/cos), coast_km          place (signed distance to coast, Natural Earth)
  woy_sin, woy_cos                      time of year of the window start
  oni_lag2                              ENSO (NOAA CPC ONI) for the 3-month season centred two months before the
                                        window, i.e. a value already published when the trip is planned
  clim_local, clim_area                 historical frequency of >= 34 kt windows at this time of year, kernel-weighted
                                        over grid cells (sigma 75 km ~ the cell itself; sigma 150 km ~ the region),
                                        from past years only (leave-one-year-out while training)
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.neighbors import BallTree

from app.ml.datasets.cyclones import EARTH_KM, ORIGIN

FEATURES = ["lat", "lon_sin", "lon_cos", "coast_km", "woy_sin", "woy_cos", "oni_lag2", "clim_local", "clim_area"]
WEEKS = 52
WOY_SMOOTH = np.array([1, 2, 3, 2, 1]) / 9         # +-2 weeks, circular
KERNELS = {"clim_local": 75.0, "clim_area": 150.0}  # Gaussian sigma, km; cut off at 3 sigma


def week_of_year(ts: pd.DatetimeIndex | pd.Series) -> np.ndarray:
    doy = pd.DatetimeIndex(ts).dayofyear.to_numpy()
    return np.minimum((doy - 1) // 7, WEEKS - 1)


def smooth_weeks(a: np.ndarray, axis: int = 1) -> np.ndarray:
    """Circular +-2 week smoothing along `axis` (the week-of-year axis)."""
    return sum(w * np.roll(a, s, axis=axis) for w, s in zip(WOY_SMOOTH, range(-2, 3)))


def kernel_weights(grid: pd.DataFrame, lat: np.ndarray, lon: np.ndarray, sigma_km: float):
    """Sparse Gaussian weights from query points to grid cells: list of (cell indices, weights) per point."""
    tree = BallTree(np.radians(grid[["lat", "lon"]].to_numpy()), metric="haversine")
    idx, dist = tree.query_radius(np.radians(np.column_stack([lat, lon])), r=3 * sigma_km / EARTH_KM,
                                  return_distance=True)
    return [(i, np.exp(-0.5 * (d * EARTH_KM / sigma_km) ** 2)) for i, d in zip(idx, dist)]


def apply_kernel(weights, table: np.ndarray) -> np.ndarray:
    """Weighted mean of table rows (cells x ...) for each query point; NaN when no cell is within reach."""
    out = np.full((len(weights),) + table.shape[1:], np.nan)
    for k, (i, w) in enumerate(weights):
        if len(i):
            out[k] = np.tensordot(w, table[i], axes=1) / w.sum()
    return out


def oni_lag2(starts: pd.DatetimeIndex, oni: pd.Series) -> np.ndarray:
    months = (pd.DatetimeIndex(starts).to_period("M") - 2)
    return oni.reindex(months).to_numpy(dtype=float)


def place_features(lat: np.ndarray, lon: np.ndarray, coast_km: np.ndarray) -> dict[str, np.ndarray]:
    return {"lat": lat, "lon_sin": np.sin(np.radians(lon)), "lon_cos": np.cos(np.radians(lon)),
            "coast_km": np.clip(coast_km, -300, 300)}


def time_features(starts: pd.DatetimeIndex) -> dict[str, np.ndarray]:
    a = 2 * np.pi * (pd.DatetimeIndex(starts).dayofyear.to_numpy() - 1) / 365.25
    return {"woy_sin": np.sin(a), "woy_cos": np.cos(a)}


def window_year(window: np.ndarray) -> np.ndarray:
    return (ORIGIN + pd.to_timedelta(np.asarray(window) * 7, unit="D")).year.to_numpy()
