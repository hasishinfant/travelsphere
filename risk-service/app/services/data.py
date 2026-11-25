"""Data acquisition with provider fallbacks. A failing provider is recorded, cached data is used only while it is
still within the source's freshness limit, and missing data is passed on as missing (never as "safe")."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from app.core.config import get_settings
from app.database import repository as repo
from app.ml import hazard_climatology
from app.geospatial.geometry import geodesic_m
from app.ingestion import gdacs, open_meteo, osrm, overpass, usgs
from app.ingestion.http import ProviderError
from app.processing.data_quality import SOURCES, merge_duplicate_hazards
from app.risk_engine.context import HistoricalRecord
from app.geospatial.countries import country_at
from app.schemas.domain import Destination, Facility, HazardEvent, PlaceInfo, Route, WeatherSnapshot

log = logging.getLogger("risk.data")
MAX_FOOTPRINT_FETCHES = 12


def _safe_repo(fn, *a, default=None, **kw):
    try:
        return fn(*a, **kw)
    except Exception as e:  # noqa: BLE001 — persistence problems must not break an assessment
        log.warning("db %s failed: %s", getattr(fn, "__name__", fn), e)
        return default


# Hard wall-clock budget per provider call (retries included) so one slow provider cannot stall an assessment
DEADLINE_S = {"overpass": 45, "osrm": 30, "open-meteo-forecast": 30, "open-meteo-geocoding": 20,
              "usgs-earthquakes": 30, "gdacs": 120}


async def _source(source_id: str, coro):
    try:
        result = await asyncio.wait_for(coro, DEADLINE_S.get(source_id, 60))
        _safe_repo(repo.record_source, source_id, True)
        return result, None
    except asyncio.TimeoutError:
        _safe_repo(repo.record_source, source_id, False, "deadline exceeded")
        log.warning("provider %s exceeded its %ss deadline", source_id, DEADLINE_S.get(source_id, 60))
        return None, f"{source_id}: no response within {DEADLINE_S.get(source_id, 60)} s"
    except (ProviderError, ValueError, KeyError, TypeError) as e:
        _safe_repo(repo.record_source, source_id, False, str(e))
        log.warning("provider %s failed: %s", source_id, e)
        return None, str(e)


async def weather_for(points: list[tuple[float, float]], now: datetime) -> tuple[list[WeatherSnapshot | None], str | None]:
    snaps, err = await _source("open-meteo-forecast", open_meteo.fetch_weather(points, now))
    return (snaps or [None] * len(points)), err


async def active_hazards(lat: float, lon: float, search_radius_m: float, now: datetime
                         ) -> tuple[list[HazardEvent] | None, list[str], list[str], list[dict]]:
    """Active hazards near a point from GDACS + USGS (+ configured zones). Returns (events|None, ok, failed, checks)."""
    (g_events, g_err), (u_events, u_err) = await asyncio.gather(
        _source("gdacs", gdacs.fetch_current(now)), _source("usgs-earthquakes", usgs.fetch_recent(now)))
    ok, failed = [], []
    events: list[HazardEvent] = []
    for sid, evs, err in (("gdacs", g_events, g_err), ("usgs-earthquakes", u_events, u_err)):
        if evs is not None:
            ok.append(sid)
            near = [e for e in evs if geodesic_m(lat, lon, e.latitude, e.longitude) <= search_radius_m]
            events += near
            _safe_repo(repo.retire_missing_current, sid, [e.external_id for e in evs])
        else:
            # Fallback: recent cached events, only while within 2× the source's freshness limit
            cached = _safe_repo(repo.cached_active_hazards, sid, lat, lon, search_radius_m,
                                SOURCES[sid].max_age_minutes * 2, default=[]) or []
            if cached:
                ok.append(sid)
                events += cached
                log.info("using %d cached %s events", len(cached), sid)
            else:
                failed.append(sid)
    if not ok:
        return None, ok, failed, []

    # Footprints for nearby GDACS events (cyclone wind buffers, flood/fire areas), nearest first
    need = sorted([e for e in events if e.source_id == "gdacs" and not e.has_footprint],
                  key=lambda e: geodesic_m(lat, lon, e.latitude, e.longitude))[:MAX_FOOTPRINT_FETCHES]
    await asyncio.gather(*(gdacs.fetch_footprint(e) for e in need))

    events, checks = merge_duplicate_hazards(events)
    events += _safe_repo(repo.risk_zones_near, lat, lon, search_radius_m, now, default=[]) or []
    _safe_repo(repo.upsert_hazards, [e for e in events if e.source_id in ("gdacs", "usgs-earthquakes")])
    return events, ok, failed, checks


_gdacs_history_cache: dict[str, tuple[datetime, list[HazardEvent]]] = {}


async def load_gdacs_history(start: datetime, end: datetime) -> list[HazardEvent] | None:
    events, _ = await _source("gdacs", gdacs.fetch_events(start, end, alert_levels="Orange;Red", max_pages=60))
    if events is not None:
        _safe_repo(repo.upsert_hazards, [e for e in events if not e.is_current])
    return events


async def history_for(lat: float, lon: float, cfg: dict, now: datetime) -> HistoricalRecord:
    h = cfg["history"]
    start = now - timedelta(days=int(365.25 * h["window_years"]))
    radius = float(h["radius_m"])
    ok, failed = [], []
    events: list[HazardEvent] = []

    # GDACS Orange/Red history is global: served from the database once loaded (refreshed weekly by the scheduler,
    # or `python -m app.ingestion.load_history`), else downloaded once and kept in memory for a day.
    g_local: list[HazardEvent] | None = None
    if _safe_repo(repo.history_loaded, "gdacs", start, default=False):
        stored = _safe_repo(repo.historical_hazards, lat, lon, radius, start, default=None)
        if stored is not None:
            g_local = [e for e in stored if e.source_id == "gdacs"]
    if g_local is None:
        key = start.date().isoformat()
        cached = _gdacs_history_cache.get(key)
        if cached and now - cached[0] < timedelta(hours=24):
            g_all = cached[1]
        else:
            g_all = await load_gdacs_history(start, now)
            if g_all is not None:
                _gdacs_history_cache[key] = (now, g_all)
        if g_all is not None:
            g_local = [e for e in g_all if geodesic_m(lat, lon, e.latitude, e.longitude) <= radius]
    if g_local is not None:
        ok.append("gdacs")
        events += g_local
    else:
        failed.append("gdacs")

    quakes, err = await _source("usgs-earthquakes", usgs.fetch_history(lat, lon, radius / 1000, start, now, h["usgs_min_magnitude"]))
    if quakes is not None:
        ok.append("usgs-earthquakes")
        events += quakes
    else:
        failed.append("usgs-earthquakes")

    incidents = _safe_repo(repo.verified_incident_count, lat, lon, radius, start)
    return HistoricalRecord(window_start=start, window_end=now, radius_m=radius, events=events if ok else None,
                            sources_ok=ok + (["travelsphere-incidents"] if incidents is not None else []),
                            sources_failed=failed, verified_incidents=incidents,
                            cyclone_climatology=hazard_climatology.load(str(get_settings().model_dir), hazard_climatology.CYCLONE),
                            flood_climatology=hazard_climatology.load(str(get_settings().model_dir), hazard_climatology.FLOOD))


async def place_info(dest: Destination) -> tuple[PlaceInfo | None, str | None]:
    name = dest.name.split(",")[0].strip()
    info, err = await _source("open-meteo-geocoding", open_meteo.lookup_place(name, dest.latitude, dest.longitude))
    if info is None and err is None:
        err = f"No GeoNames locality named {name!r} within 50 km"
    return info, err


async def facilities_near(lat: float, lon: float, radius_m: int) -> tuple[list[Facility] | None, str | None]:
    cached = _safe_repo(repo.cached_facilities, lat, lon, radius_m)
    if cached is not None:
        return cached, None
    found, err = await _source("overpass", overpass.fetch_facilities(lat, lon, radius_m))
    if found is not None:
        _safe_repo(repo.store_facilities, lat, lon, radius_m, found)
    return found, err


async def nearby_facilities(lat: float, lon: float, radius_m: int, limit: int = 60) -> dict:
    """Emergency facilities around a traveller, nearest first.

    Privacy: the Overpass query and the cache use a centre rounded to 0.01° (≤ ~0.8 km off) with a 1 km margin, so
    neither OpenStreetMap's servers nor our database see the exact position. Distances use the exact position and the
    result is cut back to the requested radius.
    """
    qlat, qlon = round(lat, 2), round(lon, 2)
    qradius = radius_m + 1000
    cached = _safe_repo(repo.cached_facilities, qlat, qlon, qradius)
    err = None
    if cached is not None:
        found = cached
    else:
        found, err = await _source("overpass", overpass.fetch_facilities(qlat, qlon, qradius))
        if found is not None:
            _safe_repo(repo.store_facilities, qlat, qlon, qradius, found)
    rows = []
    for f in found or []:
        d = geodesic_m(lat, lon, f.latitude, f.longitude)
        if d <= radius_m:
            rows.append({"osm_id": f.osm_id, "kind": f.kind, "name": f.name, "latitude": f.latitude,
                         "longitude": f.longitude, "distance_m": round(d), "phone": f.phone, "healthcare": f.healthcare,
                         "has_emergency": f.has_emergency,
                         "retrieved_at": f.retrieved_at.isoformat() if f.retrieved_at else None})
    rows.sort(key=lambda r: r["distance_m"])
    return {"facilities": rows[:limit], "radius_m": radius_m, "cached": cached is not None,
            "source": "OpenStreetMap contributors, via the Overpass API",
            "licence": "ODbL 1.0 (https://www.openstreetmap.org/copyright)",
            "country_code": country_at(lat, lon),
            "error": None if found is not None else (err or "facility lookup failed")}


async def routes_for(waypoints: list[tuple[float, float]], profile: str) -> tuple[Route, list[Route]]:
    routes, err = await _source("osrm", osrm.fetch_routes(waypoints, profile))
    if routes:
        return routes[0], routes[1:]
    return osrm.straight_line(waypoints, profile), []


async def drive_minutes(origin: tuple[float, float], targets: list[tuple[float, float]]) -> list[float | None] | None:
    res, _ = await _source("osrm", osrm.driving_minutes(origin, targets))
    return res
