"""Feature engineering shared by training (ERA5 daily reanalysis) and inference (Open-Meteo forecast daily values),
so the two can never drift apart. All features describe weather up to and including the day being scored —
nothing from later days (no temporal leakage)."""
from __future__ import annotations

import math
from datetime import date, timedelta

import numpy as np
import pandas as pd

FEATURES = [
    "precip_1d_mm", "precip_3d_mm", "precip_7d_mm", "precip_max_1d_7d_mm",
    "gust_max_1d_ms", "gust_max_3d_ms", "temp_max_c", "temp_range_c",
    "month_sin", "month_cos", "abs_latitude",
]


def _season(d: date) -> tuple[float, float]:
    a = 2 * math.pi * (d.timetuple().tm_yday - 1) / 365.25
    return math.sin(a), math.cos(a)


def features_from_daily(day: date, precip: dict[str, float | None], gust: dict[str, float | None],
                        tmax: dict[str, float | None], tmin: dict[str, float | None], latitude: float) -> dict | None:
    """Features for one day from per-date dicts (ISO date → value). None when the 7-day history is incomplete."""
    days = [(day - timedelta(days=i)).isoformat() for i in range(7)]
    p = [precip.get(d) for d in days]
    g = [gust.get(d) for d in days[:3]]
    if any(v is None for v in p) or g[0] is None or tmax.get(days[0]) is None or tmin.get(days[0]) is None:
        return None
    s, c = _season(day)
    return {
        "precip_1d_mm": p[0], "precip_3d_mm": sum(p[:3]), "precip_7d_mm": sum(p), "precip_max_1d_7d_mm": max(p),
        "gust_max_1d_ms": g[0], "gust_max_3d_ms": max(v for v in g if v is not None),
        "temp_max_c": tmax[days[0]], "temp_range_c": tmax[days[0]] - tmin[days[0]],
        "month_sin": s, "month_cos": c, "abs_latitude": abs(latitude),
    }


def features_frame(daily: pd.DataFrame) -> pd.DataFrame:
    """Vectorised version for training: `daily` has columns location_id, latitude, date, precip, gust, tmax, tmin,
    sorted by date within each location. Rolling windows are backward-looking only."""
    df = daily.sort_values(["location_id", "date"]).copy()
    g = df.groupby("location_id", group_keys=False)
    df["precip_1d_mm"] = df["precip"]
    df["precip_3d_mm"] = g["precip"].rolling(3, min_periods=3).sum().reset_index(level=0, drop=True)
    df["precip_7d_mm"] = g["precip"].rolling(7, min_periods=7).sum().reset_index(level=0, drop=True)
    df["precip_max_1d_7d_mm"] = g["precip"].rolling(7, min_periods=7).max().reset_index(level=0, drop=True)
    df["gust_max_1d_ms"] = df["gust"]
    df["gust_max_3d_ms"] = g["gust"].rolling(3, min_periods=3).max().reset_index(level=0, drop=True)
    df["temp_max_c"] = df["tmax"]
    df["temp_range_c"] = df["tmax"] - df["tmin"]
    doy = pd.to_datetime(df["date"]).dt.dayofyear
    df["month_sin"] = np.sin(2 * np.pi * (doy - 1) / 365.25)
    df["month_cos"] = np.cos(2 * np.pi * (doy - 1) / 365.25)
    df["abs_latitude"] = df["latitude"].abs()
    return df
