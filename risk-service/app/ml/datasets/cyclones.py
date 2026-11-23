"""Tropical-cyclone exposure dataset from IBTrACS (NOAA NCEI best tracks, every agency, every basin, since 1980).

Question : will a cyclone with tropical-storm-force winds (>= 34 kt) pass within RADIUS_KM of a place during a
           7-day window? `y64` marks windows with hurricane/typhoon-force winds (>= 64 kt) in the radius.
Places   : a regular grid (GRID_DEG) over land and coast (cell centre within COAST_KM of land) between +-MAX_LAT,
           chosen without looking at where storms went, so prevalence reflects real places and not event sites.
Windows  : consecutive 7-day windows starting Monday 1980-01-07.
Storage  : only the grid and the positive (cell, window) pairs; every other cell-window is a negative.

Sources (all free, public): IBTrACS v04r01 since-1980 CSV (NOAA NCEI; cite Knapp et al. 2010), Natural Earth
1:50m land (public domain), NOAA CPC Oceanic Nino Index (public domain).

Usage: python -m app.ml.datasets.cyclones            (expects the downloads under data/, see docs/ML.md)
"""
from __future__ import annotations

import json
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import shapely
from sklearn.neighbors import BallTree

from app.core.config import SERVICE_ROOT

DATA = SERVICE_ROOT / "data"
IBTRACS_CSV = DATA / "ibtracs" / "ibtracs.since1980.csv"
LAND_ZIP = DATA / "naturalearth" / "ne_50m_land.zip"
ONI_TXT = DATA / "enso" / "oni.ascii.txt"
OUT_DIR = DATA / "ml" / "cyclones"

RADIUS_KM = 100
TS_KT, HURRICANE_KT = 34, 64
GRID_DEG, MAX_LAT, COAST_KM = 2.0, 45.0, 200
ORIGIN = pd.Timestamp("1980-01-07")          # a Monday; window w covers ORIGIN + 7w ... +7 days
EARTH_KM = 6371.0088
TEN_MIN_TO_ONE_MIN = 1 / 0.88                # WMO guidance (Harper et al. 2010) when only 10-min winds exist


def load_tracks(path: Path = IBTRACS_CSV) -> pd.DataFrame:
    """One row per best-track fix: sid, time, lat, lon, wind_kt (1-minute sustained). USA_WIND (JTWC/NHC, 1-min)
    when present, else WMO_WIND converted from the agency's 10-min average. Spur tracks and fixes without wind are
    dropped; provisional recent tracks are kept (flagged in the metadata)."""
    cols = ["SID", "ISO_TIME", "LAT", "LON", "WMO_WIND", "WMO_AGENCY", "USA_WIND", "TRACK_TYPE"]
    df = pd.read_csv(path, usecols=cols, skiprows=[1], na_values=[" ", ""], keep_default_na=False, low_memory=False)
    df = df[df["TRACK_TYPE"].isin(["main", "PROVISIONAL", "US-PROVISIONAL"])]   # not spur tracks
    usa = pd.to_numeric(df["USA_WIND"], errors="coerce")
    wmo = pd.to_numeric(df["WMO_WIND"], errors="coerce")
    # NHC/CPHC report 1-minute winds as the WMO value; other agencies use 10-minute averages
    wmo_1min = np.where(df["WMO_AGENCY"].isin(["hurdat_atl", "hurdat_epa", "cphc"]), wmo, wmo * TEN_MIN_TO_ONE_MIN)
    out = pd.DataFrame({"sid": df["SID"], "time": pd.to_datetime(df["ISO_TIME"]),
                        "lat": pd.to_numeric(df["LAT"]), "lon": pd.to_numeric(df["LON"]),
                        "wind_kt": usa.fillna(pd.Series(wmo_1min, index=df.index))})
    return out.dropna(subset=["wind_kt", "lat", "lon"]).sort_values(["sid", "time"]).reset_index(drop=True)


def interpolate_hourly(tracks: pd.DataFrame) -> pd.DataFrame:
    """Linear interpolation of each storm to hourly fixes (longitude unwrapped across the dateline), so a storm
    moving 30 km/h cannot jump over a place between 3- or 6-hourly fixes."""
    parts = []
    for sid, g in tracks.groupby("sid", sort=False):
        t = (g["time"].to_numpy() - np.datetime64("1970-01-01")) / np.timedelta64(1, "h")
        if len(t) < 2:
            parts.append(g)
            continue
        th = np.arange(t[0], t[-1] + 1e-9, 1.0)
        lon = np.unwrap(np.radians(g["lon"].to_numpy()))
        parts.append(pd.DataFrame({
            "sid": sid, "time": np.datetime64("1970-01-01") + (th * 3600).astype("timedelta64[s]"),
            "lat": np.interp(th, t, g["lat"].to_numpy()),
            "lon": (np.degrees(np.interp(th, t, lon)) + 180) % 360 - 180,
            "wind_kt": np.interp(th, t, g["wind_kt"].to_numpy())}))
    return pd.concat(parts, ignore_index=True)


def load_land(path: Path = LAND_ZIP):
    import geopandas as gpd
    with zipfile.ZipFile(path) as z:
        shp = next(n for n in z.namelist() if n.endswith(".shp"))
    return shapely.union_all(gpd.read_file(f"zip://{path}!{shp}").geometry.values)


def coast_distance_km(lat: np.ndarray, lon: np.ndarray, land) -> np.ndarray:
    """Signed distance to the nearest coastline vertex (Natural Earth 1:50m): positive inland, negative at sea."""
    verts = shapely.get_coordinates(shapely.boundary(land))
    tree = BallTree(np.radians(verts[:, ::-1]), metric="haversine")
    d, _ = tree.query(np.radians(np.column_stack([lat, lon])), k=1)
    inside = shapely.contains_xy(land, lon, lat)
    return np.where(inside, 1, -1) * d[:, 0] * EARTH_KM


def build_grid(land) -> pd.DataFrame:
    return grid_cells(land, -MAX_LAT, MAX_LAT, -COAST_KM)


def grid_cells(land, lat_min: float, lat_max: float, min_coast_km: float, deg: float = GRID_DEG) -> pd.DataFrame:
    """Regular grid cells between the latitudes whose signed coast distance is above min_coast_km
    (negative = that far out to sea is still kept)."""
    half = deg / 2
    lats = np.arange(lat_min + half, lat_max, deg)
    lons = np.arange(-180 + half, 180, deg)
    la, lo = (a.ravel() for a in np.meshgrid(lats, lons, indexing="ij"))
    dist = coast_distance_km(la, lo, land)
    keep = dist > min_coast_km
    g = pd.DataFrame({"lat": la[keep], "lon": lo[keep], "coast_km": dist[keep].round(1)})
    g.insert(0, "cell", np.arange(len(g)))
    return g


def label_windows(hourly: pd.DataFrame, grid: pd.DataFrame) -> pd.DataFrame:
    """Positive (cell, window) pairs: any hourly fix with wind >= 34 kt within RADIUS_KM of the cell centre.
    Keeps the strongest wind seen and the storms involved."""
    strong = hourly[hourly["wind_kt"] >= TS_KT]
    tree = BallTree(np.radians(grid[["lat", "lon"]].to_numpy()), metric="haversine")
    hits = tree.query_radius(np.radians(strong[["lat", "lon"]].to_numpy()), r=RADIUS_KM / EARTH_KM)
    n = np.fromiter((len(h) for h in hits), int, len(hits))
    rows = np.repeat(np.arange(len(strong)), n)
    cells = np.concatenate(hits) if len(hits) else np.array([], int)
    window = ((strong["time"].to_numpy()[rows] - ORIGIN.to_datetime64()) // np.timedelta64(7, "D")).astype(int)
    pos = pd.DataFrame({"cell": grid["cell"].to_numpy()[cells], "window": window,
                        "wind_kt": strong["wind_kt"].to_numpy()[rows], "sid": strong["sid"].to_numpy()[rows]})
    pos = pos[pos["window"] >= 0]
    out = pos.groupby(["cell", "window"]).agg(wind_kt=("wind_kt", "max"),
                                              storms=("sid", lambda s: ";".join(sorted(set(s))))).reset_index()
    out["y64"] = (out["wind_kt"] >= HURRICANE_KT).astype(int)
    out["wind_kt"] = out["wind_kt"].round(1)
    return out


def load_oni(path: Path = ONI_TXT) -> pd.Series:
    """Monthly ONI anomaly keyed by the centre month of each 3-month season (DJF -> January)."""
    rows = [l.split() for l in path.read_text().splitlines()[1:] if l.strip()]
    order = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"]
    idx = [pd.Period(year=int(y), month=order.index(s) + 1, freq="M") for s, y, _, _ in rows]
    return pd.Series([float(a) for *_, a in rows], index=pd.PeriodIndex(idx), name="oni")


def window_start(window: np.ndarray | int) -> pd.DatetimeIndex:
    return ORIGIN + pd.to_timedelta(np.asarray(window) * 7, unit="D")


def build() -> Path:
    for p in (IBTRACS_CSV, LAND_ZIP, ONI_TXT):
        if not p.exists():
            raise SystemExit(f"missing {p} — see docs/ML.md for the download commands")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tracks = load_tracks()
    hourly = interpolate_hourly(tracks)
    land = load_land()
    grid = build_grid(land)
    pos = label_windows(hourly, grid)
    last_fix = tracks["time"].max()
    n_windows = int((last_fix - ORIGIN) // pd.Timedelta(days=7))      # complete windows only
    pos = pos[pos["window"] < n_windows]
    grid.to_csv(OUT_DIR / "grid.csv", index=False)
    pos.to_csv(OUT_DIR / "positives.csv.gz", index=False)
    meta = {
        "built_at": datetime.now(timezone.utc).isoformat(),
        "label": f"cyclone >= {TS_KT} kt (1-min) within {RADIUS_KM} km during a 7-day window; y64: >= {HURRICANE_KT} kt",
        "sources": {"tracks": "IBTrACS v04r01 since-1980 (NOAA NCEI), main tracks, hourly interpolation",
                    "land": "Natural Earth 1:50m land (public domain)", "enso": "NOAA CPC ONI (public domain)"},
        "grid": {"deg": GRID_DEG, "max_lat": MAX_LAT, "coast_km": COAST_KM, "cells": int(len(grid)),
                 "land_cells": int((grid["coast_km"] > 0).sum())},
        "windows": {"origin": ORIGIN.date().isoformat(), "count": n_windows,
                    "last_complete_start": window_start(n_windows - 1).date().isoformat()},
        "tracks": {"storms": int(tracks["sid"].nunique()), "fixes": int(len(tracks)),
                   "last_fix": str(last_fix), "hourly_fixes": int(len(hourly))},
        "rows": int(len(grid) * n_windows), "positives": int(len(pos)), "positives_64kt": int(pos["y64"].sum()),
        "prevalence": round(len(pos) / (len(grid) * n_windows), 5),
        "notes": ["Recent IBTrACS tracks are provisional until agencies finalise best tracks.",
                  "Agency 10-min winds converted to 1-min with factor 1/0.88 where no USA_WIND exists."],
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta, indent=1))
    print(json.dumps({k: meta[k] for k in ("grid", "windows", "tracks", "rows", "positives", "positives_64kt",
                                           "prevalence")}, indent=1))
    return OUT_DIR


if __name__ == "__main__":
    build()
