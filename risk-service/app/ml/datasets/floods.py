"""Large-flood exposure dataset from the Dartmouth Flood Observatory (DFO) Global Active Archive of Large Flood Events.

Question : does the mapped affected area of a large flood come within 100 km of a place during a 7-day window?
           `y_severe` marks DFO severity >= 1.5 (class 1.5: recurrence 20-100 years; class 2: > 100 years).
Places   : 2-degree grid over land (cell centre on land or within LAND_KM of it), 56 S to 72 N, chosen without looking
           at where floods happened.
Windows  : consecutive 7-day windows from Monday 1985-01-07; a flood counts in every window its BEGAN..ENDED period
           overlaps.
Storage  : grid + positive (cell, window) pairs, as for cyclones.

Source: DFO archive via its public ArcGIS mirror (5,131 events, 1985-01 to 2021-10; the DFO site itself was
unreachable on 2026-11-23). Licence: free for scholarly and educational use (DFO states CC BY-NC-SA 4.0) — NOT
cleared for commercial use. Affected-area outlines are approximate regions drawn from news and satellite reports
(median ~35,000 km2), so a positive means "a large flood affected this region", not that the point itself flooded.
Reporting effort varied over time (about 50 events/yr in 1985-87, 250/yr in 2002-07, 100-150/yr after 2010).

Usage: python -m app.ml.datasets.floods     (expects data/dfo/part_*.geojson, see docs/ML.md)
"""
from __future__ import annotations

import glob
import json
from datetime import datetime, timezone

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely

from app.ml.datasets.cyclones import DATA, grid_cells, load_land

DFO_GLOB = str(DATA / "dfo" / "part_*.geojson")
OUT_DIR = DATA / "ml" / "floods"
ORIGIN = pd.Timestamp("1985-01-07")       # a Monday
LAT_MIN, LAT_MAX, LAND_KM = -56.0, 72.0, 50
RADIUS_KM = 100
SEVERE = 1.5


def window_start(window) -> pd.DatetimeIndex | pd.Timestamp:
    return ORIGIN + pd.to_timedelta(np.asarray(window) * 7, unit="D")


def load_events(pattern: str = DFO_GLOB) -> gpd.GeoDataFrame:
    files = sorted(glob.glob(pattern))
    if not files:
        raise SystemExit(f"no DFO files at {pattern} — see docs/ML.md for the download commands")
    g = pd.concat([gpd.read_file(f) for f in files], ignore_index=True)
    g = gpd.GeoDataFrame(g, geometry="geometry", crs="EPSG:4326").drop_duplicates(subset=["ID"])
    g["began"] = pd.to_datetime(g["BEGAN"], unit="ms").dt.normalize()
    g["ended"] = pd.to_datetime(g["ENDED"], unit="ms").dt.normalize()
    g = g[g["ended"] >= g["began"]]
    g["geometry"] = shapely.make_valid(g.geometry.values)          # 26 outlines self-intersect
    return g[~g.geometry.is_empty].reset_index(drop=True)


def circles(grid: pd.DataFrame, radius_km: float = RADIUS_KM, n: int = 48) -> gpd.GeoDataFrame:
    """~radius_km circles around cell centres, drawn as ellipses in degrees (exact enough at 100 km)."""
    a = np.linspace(0, 2 * np.pi, n, endpoint=False)
    dlat = radius_km / 111.2
    polys = [shapely.Polygon(np.column_stack([lo + dlat / max(np.cos(np.radians(la)), 0.05) * np.cos(a),
                                              la + dlat * np.sin(a)]))
             for la, lo in zip(grid["lat"], grid["lon"])]
    return gpd.GeoDataFrame(grid[["cell"]], geometry=polys, crs="EPSG:4326")


def label_windows(events: gpd.GeoDataFrame, grid: pd.DataFrame, n_windows: int) -> pd.DataFrame:
    """Positive (cell, window) pairs: an event outline comes within RADIUS_KM of the cell centre during a window the
    event overlaps. A radius, not point-in-polygon: outlines smaller than the 2-degree spacing would otherwise fall
    between cell centres (e.g. Germany, July 2021: 8,500 km2, 6 km from the nearest centre)."""
    hits = gpd.sjoin(circles(grid), events[["ID", "began", "ended", "SEVERITY", "geometry"]], predicate="intersects")
    first = ((hits["began"] - ORIGIN) // pd.Timedelta(days=7)).astype(int)
    last = ((hits["ended"] - ORIGIN) // pd.Timedelta(days=7)).astype(int)
    n = (last - first + 1).to_numpy()
    rows = np.repeat(np.arange(len(hits)), n)
    window = first.to_numpy()[rows] + (np.arange(len(rows)) - np.repeat(np.cumsum(n) - n, n))
    pos = pd.DataFrame({"cell": hits["cell"].to_numpy()[rows], "window": window,
                        "severity": hits["SEVERITY"].to_numpy()[rows], "event": hits["ID"].to_numpy()[rows]})
    pos = pos[(pos["window"] >= 0) & (pos["window"] < n_windows)]
    out = pos.groupby(["cell", "window"]).agg(severity=("severity", "max"),
                                              events=("event", lambda s: ";".join(str(int(e)) for e in sorted(set(s))))).reset_index()
    out["y_severe"] = (out["severity"] >= SEVERE).astype(int)
    return out


def build() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    events = load_events()
    grid = grid_cells(load_land(), LAT_MIN, LAT_MAX, -LAND_KM)
    last = events["began"].max()
    n_windows = int((last - ORIGIN) // pd.Timedelta(days=7)) + 1
    pos = label_windows(events, grid, n_windows)
    grid.to_csv(OUT_DIR / "grid.csv", index=False)
    pos.to_csv(OUT_DIR / "positives.csv.gz", index=False)
    meta = {
        "built_at": datetime.now(timezone.utc).isoformat(),
        "label": "DFO large-flood affected area within 100 km during a 7-day window; y_severe: DFO severity >= 1.5",
        "sources": {"floods": "Dartmouth Flood Observatory Global Active Archive (ArcGIS mirror; CC BY-NC-SA 4.0, "
                              "non-commercial)", "land": "Natural Earth 1:50m land (public domain)"},
        "grid": {"deg": 2.0, "lat": [LAT_MIN, LAT_MAX], "land_km": LAND_KM, "cells": int(len(grid))},
        "windows": {"origin": ORIGIN.date().isoformat(), "count": n_windows,
                    "last_start": window_start(n_windows - 1).date().isoformat()},
        "events": {"count": int(len(events)), "first": str(events["began"].min().date()), "last": str(last.date()),
                   "per_year": {int(k): int(v) for k, v in events.groupby(events["began"].dt.year).size().items()}},
        "rows": int(len(grid) * n_windows), "positives": int(len(pos)), "positives_severe": int(pos["y_severe"].sum()),
        "prevalence": round(len(pos) / (len(grid) * n_windows), 5),
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta, indent=1))
    print(json.dumps({k: meta[k] for k in ("grid", "windows", "rows", "positives", "positives_severe", "prevalence")},
                     indent=1))


if __name__ == "__main__":
    build()
