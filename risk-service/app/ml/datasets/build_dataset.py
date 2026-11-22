"""Build the labelled hazard-event dataset from two independent public sources.

Target  : y = 1 if a GDACS Orange/Red FLOOD or TROPICAL-CYCLONE event (official, impact-graded) was active within
          LABEL_RADIUS_KM of the location on that day (between the event's fromdate and todate), else 0.
          `y_red` marks days with a Red event (used for high-risk recall).
Features: ERA5 reanalysis daily weather (Open-Meteo archive API): precipitation sum, max wind gust, max/min
          temperature — the same daily variables the forecast API provides at inference time.
Locations: one per GDACS event cluster (0.5° cells merged within 150 km) — every event is represented — plus the
          TravelSphere destinations as full-period controls. Event locations contribute every day of the calendar
          years in which they had events, so most rows are negative.

Known limitations (reported with the model): event centroids only (no historical polygons), so labels are spatially
coarse; location selection is event-driven (positives are concentrated at event locations); ERA5 (~25 km) is smoother
than point forecasts. Nothing here is synthetic.

Usage: python -m app.ml.datasets.build_dataset [--start 2022-01-01] [--end 2024-12-31] [--max-locations N]
"""
from __future__ import annotations

import argparse
import asyncio
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

from app.core.config import SERVICE_ROOT, get_settings
from app.geospatial.geometry import geodesic_m
from app.ingestion import gdacs
from app.ingestion.http import ProviderError, get_http

DATA_DIR = SERVICE_ROOT / "data" / "ml"
ERA5_CACHE = SERVICE_ROOT / "data" / "era5"
LABEL_RADIUS_KM = 100
DESTINATIONS = [("paris", 48.8584, 2.2945), ("london", 51.5055, -0.0754), ("rome", 41.8902, 12.4922),
                ("santorini", 36.4618, 25.3753), ("tokyo", 35.6595, 139.7005), ("kyoto", 34.9986, 135.785),
                ("bali", -8.2752, 115.1668), ("new-york", 40.758, -73.9855), ("iceland", 63.6156, -19.9886),
                ("bengaluru", 12.9791, 77.5913)]
ARCHIVE_SPACING_S = 8.0   # Open-Meteo counts a multi-year request as many calls; stay well under the per-minute limit


async def fetch_era5(loc_id: str, lat: float, lon: float, start: date, end: date) -> pd.DataFrame:
    ERA5_CACHE.mkdir(parents=True, exist_ok=True)
    cache = ERA5_CACHE / f"{loc_id}_{start}_{end}.json"
    if cache.exists():
        body = json.loads(cache.read_text())
    else:
        params = {"latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}", "start_date": start.isoformat(),
                  "end_date": end.isoformat(), "timezone": "auto", "wind_speed_unit": "ms",
                  "daily": "precipitation_sum,wind_gusts_10m_max,temperature_2m_max,temperature_2m_min"}
        res = await get_http().get_json("open-meteo-archive", get_settings().open_meteo_archive_url, params,
                                        retries=4, timeout_s=60)
        body = res.data
        cache.write_text(json.dumps(body))
        await asyncio.sleep(ARCHIVE_SPACING_S)
    d = body.get("daily") or {}
    return pd.DataFrame({"location_id": loc_id, "latitude": lat, "longitude": lon,
                         "date": pd.to_datetime(d.get("time", [])).date,
                         "precip": d.get("precipitation_sum"), "gust": d.get("wind_gusts_10m_max"),
                         "tmax": d.get("temperature_2m_max"), "tmin": d.get("temperature_2m_min")})


def pick_locations(events, max_locations: int | None = None) -> list[tuple[str, float, float, list[int]]]:
    """One location per event cluster (0.5° cells, merged within 150 km) so EVERY event year is represented —
    selecting only the densest cells biased the labels towards the most recent year. Each location carries the
    calendar years of the events within the label radius; only those years are downloaded."""
    chosen: list[tuple[float, float]] = []
    for e in sorted(events, key=lambda e: e.valid_from):
        la, lo = round(e.latitude * 2) / 2, round(e.longitude * 2) / 2
        if all(geodesic_m(la, lo, a, b) > 150_000 for a, b in chosen):
            chosen.append((la, lo))
    if max_locations:
        chosen = chosen[:max_locations]
    out = []
    for la, lo in chosen:
        years = sorted({y for ev in events if geodesic_m(la, lo, ev.latitude, ev.longitude) <= LABEL_RADIUS_KM * 1000
                        for y in range(ev.valid_from.year, (ev.valid_to or ev.valid_from).year + 1)})
        out.append((f"ev_{la:+.1f}_{lo:+.1f}".replace(".", "p"), la, lo, years))
    return out


def year_ranges(years: list[int], start: date, end: date) -> list[tuple[date, date]]:
    """Merge consecutive years into ranges, clipped to the study period, with 6 lead-in days for rolling features."""
    ranges: list[list[int]] = []
    for y in years:
        if ranges and y == ranges[-1][1] + 1:
            ranges[-1][1] = y
        else:
            ranges.append([y, y])
    return [(max(start, date(a, 1, 1)) - timedelta(days=6), min(end, date(b, 12, 31))) for a, b in ranges
            if date(a, 1, 1) <= end and date(b, 12, 31) >= start]


def label(df: pd.DataFrame, events) -> pd.DataFrame:
    df = df.copy()
    df["y"] = 0
    df["y_red"] = 0
    df["event_ids"] = ""
    locs = df[["location_id", "latitude", "longitude"]].drop_duplicates()
    for loc in locs.itertuples():
        mask_loc = df["location_id"] == loc.location_id
        for e in events:
            if geodesic_m(loc.latitude, loc.longitude, e.latitude, e.longitude) > LABEL_RADIUS_KM * 1000:
                continue
            start = e.valid_from.date()
            end = (e.valid_to or e.valid_from).date()
            m = mask_loc & (df["date"] >= start) & (df["date"] <= end)
            df.loc[m, "y"] = 1
            if e.alert_level == "red":
                df.loc[m, "y_red"] = 1
            df.loc[m, "event_ids"] = df.loc[m, "event_ids"] + e.external_id + ";"
    return df


async def build(start: date, end: date, max_locations: int) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    s = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
    e = datetime.combine(end, datetime.min.time(), tzinfo=timezone.utc)
    events = await gdacs.fetch_events(s, e, alert_levels="Orange;Red", event_types="FL;TC", max_pages=30)
    print(f"GDACS Orange/Red flood + cyclone events {start}..{end}: {len(events)}")
    full = (start - timedelta(days=6), end)
    plan: list[tuple[str, float, float, list[tuple[date, date]]]] = []
    for lid, la, lo, years in pick_locations(events, max_locations):
        # reuse a full-period download if one is cached, otherwise fetch only the event years
        cached_full = (ERA5_CACHE / f"{lid}_{full[0]}_{full[1]}.json").exists()
        plan.append((lid, la, lo, [full] if cached_full else year_ranges(years, start, end)))
    plan += [(lid, la, lo, [full]) for lid, la, lo in DESTINATIONS]
    frames = []
    for i, (lid, la, lo, ranges) in enumerate(plan, 1):
        for a, b in ranges:
            try:
                frames.append(await fetch_era5(lid, la, lo, a, b))
                print(f"  [{i}/{len(plan)}] {lid} {a}..{b} ok")
            except ProviderError as err:
                print(f"  [{i}/{len(plan)}] {lid} {a}..{b} FAILED: {err}")
    daily = pd.concat(frames, ignore_index=True)
    labelled = label(daily, events)
    out = DATA_DIR / "hazard_event_dataset.csv.gz"
    labelled.to_csv(out, index=False)
    meta = {"built_at": datetime.now(timezone.utc).isoformat(), "period": [start.isoformat(), end.isoformat()],
            "label": f"GDACS Orange/Red FL or TC event active within {LABEL_RADIUS_KM} km (event centroid)",
            "sources": {"labels": "GDACS event API (UN OCHA / EC JRC)", "features": "ERA5 via Open-Meteo archive API (CC BY 4.0)"},
            "events": len(events), "locations": len(frames), "rows": int(len(labelled)),
            "positives": int(labelled["y"].sum()), "red_positives": int(labelled["y_red"].sum()),
            "event_list": [{"id": ev.external_id, "type": ev.hazard_type, "alert": ev.alert_level, "title": ev.title,
                            "from": ev.valid_from.date().isoformat(),
                            "to": (ev.valid_to or ev.valid_from).date().isoformat(),
                            "lat": ev.latitude, "lon": ev.longitude} for ev in events]}
    (DATA_DIR / "dataset_meta.json").write_text(json.dumps(meta, indent=1))
    print(f"wrote {out} — {meta['rows']} rows, {meta['positives']} positive ({meta['red_positives']} red)")
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2022-01-01")
    ap.add_argument("--end", default="2024-12-31")
    ap.add_argument("--max-locations", type=int, default=None)
    a = ap.parse_args()
    asyncio.run(build(date.fromisoformat(a.start), date.fromisoformat(a.end), a.max_locations))
