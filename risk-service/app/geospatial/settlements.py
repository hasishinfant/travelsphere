"""Nearest settlements from GeoNames `cities1000` (all populated places with ≥ 1 000 inhabitants, CC BY 4.0).

Download (about 11 MB, refreshed daily by GeoNames):
    curl -o risk-service/data/geonames/cities1000.zip https://download.geonames.org/export/dump/cities1000.zip
Without the file the remoteness factor is reported as unavailable — never as "not remote".

Populations are GeoNames' point attributes for the administrative place, not a measured urban footprint.
"""
from __future__ import annotations

import math
import zipfile
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

from app.core.config import SERVICE_ROOT

CITIES_ZIP = SERVICE_ROOT / "data" / "geonames" / "cities1000.zip"
COLUMNS = {1: "name", 4: "lat", 5: "lon", 7: "feature_code", 8: "country", 14: "population"}


@lru_cache(maxsize=1)
def _table(path: str = str(CITIES_ZIP)) -> pd.DataFrame | None:
    if not Path(path).exists():
        return None
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.endswith(".txt"))
        with z.open(name) as f:
            df = pd.read_csv(f, sep="\t", header=None, usecols=list(COLUMNS), names=None, dtype=str,
                             quoting=3, keep_default_na=False)
    df = df.rename(columns=COLUMNS)
    df["lat"] = pd.to_numeric(df["lat"], errors="coerce")
    df["lon"] = pd.to_numeric(df["lon"], errors="coerce")
    df["population"] = pd.to_numeric(df["population"], errors="coerce").fillna(0).astype(int)
    df = df.dropna(subset=["lat", "lon"])
    # Populated places only (PPL*), excluding historical/abandoned ones (PPLH, PPLQ, PPLW)
    df = df[df["feature_code"].str.startswith("PPL") & ~df["feature_code"].isin(["PPLH", "PPLQ", "PPLW"])]
    return df.reset_index(drop=True)


def available(path: Path = CITIES_ZIP) -> bool:
    return _table(str(path)) is not None


def _haversine_m(lat: float, lon: float, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    p1, p2 = math.radians(lat), np.radians(lats)
    dp, dl = p2 - p1, np.radians(lons) - math.radians(lon)
    a = np.sin(dp / 2) ** 2 + math.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * 6_371_000 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def nearest(lat: float, lon: float, min_population: int, path: Path = CITIES_ZIP) -> dict | None:
    """Nearest populated place with at least `min_population` inhabitants: {name, country, population, distance_m}.
    None if the GeoNames file is not installed or nothing qualifies."""
    df = _table(str(path))
    if df is None:
        return None
    cand = df[df["population"] >= min_population]
    if cand.empty:
        return None
    for box in (1.0, 5.0, None):  # degrees around the point; widen until something is found
        sub = cand if box is None else cand[(cand["lat"].sub(lat).abs() <= box) &
                                            (((cand["lon"] - lon + 180) % 360 - 180).abs() <= box / max(0.2, math.cos(math.radians(lat))))]
        if not sub.empty:
            d = _haversine_m(lat, lon, sub["lat"].to_numpy(), sub["lon"].to_numpy())
            i = int(np.argmin(d))
            r = sub.iloc[i]
            # a nearer place may sit just outside a small box: only accept if it is inside the box's guaranteed radius
            c = math.cos(math.radians(lat))
            if box is None or d[i] <= 0.9 * box * 111_000 * min(1.0, c / max(0.2, c)):
                return {"name": r["name"], "country": r["country"], "population": int(r["population"]),
                        "distance_m": float(d[i]), "latitude": float(r["lat"]), "longitude": float(r["lon"])}
    return None
