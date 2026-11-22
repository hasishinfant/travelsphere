"""Dataset validation run before training. Any failed hard check stops training."""
from __future__ import annotations

import pandas as pd

from app.geospatial.geometry import valid_coordinate

REQUIRED = ["location_id", "latitude", "longitude", "date", "precip", "gust", "tmax", "tmin", "y", "y_red"]
RANGES = {"precip": (0, 2000), "gust": (0, 120), "tmax": (-90, 65), "tmin": (-90, 65)}


def validate(df: pd.DataFrame) -> dict:
    report: dict = {"rows": int(len(df)), "hard_failures": [], "warnings": []}
    missing_cols = [c for c in REQUIRED if c not in df.columns]
    if missing_cols:
        report["hard_failures"].append(f"missing columns: {missing_cols}")
        return report
    dup = int(df.duplicated(subset=["location_id", "date"]).sum())
    if dup:
        report["hard_failures"].append(f"{dup} duplicate (location, date) rows")
    bad_coords = int((~df.apply(lambda r: valid_coordinate(r.latitude, r.longitude), axis=1)).sum())
    if bad_coords:
        report["hard_failures"].append(f"{bad_coords} rows with invalid coordinates")
    report["missing_values"] = {c: int(df[c].isna().sum()) for c in RANGES}
    out_of_range = {c: int(((df[c] < lo) | (df[c] > hi)).sum()) for c, (lo, hi) in RANGES.items()}
    report["out_of_range"] = out_of_range
    if any(out_of_range.values()):
        report["warnings"].append(f"out-of-range values set to missing: {out_of_range}")
    if not set(df["y"].unique()) <= {0, 1}:
        report["hard_failures"].append("label y is not binary")
    if (df["y_red"] > df["y"]).any():
        report["hard_failures"].append("y_red set where y is 0")
    pos = int(df["y"].sum())
    report["positives"] = pos
    report["positive_rate"] = round(pos / len(df), 5) if len(df) else 0
    report["red_positives"] = int(df["y_red"].sum())
    report["locations"] = int(df["location_id"].nunique())
    report["locations_with_positives"] = int(df.groupby("location_id")["y"].max().sum())
    d = pd.to_datetime(df["date"])
    report["date_range"] = [d.min().date().isoformat(), d.max().date().isoformat()]
    gaps = df.groupby("location_id")["date"].count()
    report["days_per_location"] = {"min": int(gaps.min()), "max": int(gaps.max())}
    if pos < 50:
        report["hard_failures"].append(f"only {pos} positive examples — too few to train and evaluate")
    return report


def clean(df: pd.DataFrame) -> pd.DataFrame:
    df = df.drop_duplicates(subset=["location_id", "date"]).copy()
    for c, (lo, hi) in RANGES.items():
        df.loc[(df[c] < lo) | (df[c] > hi), c] = pd.NA
    return df
