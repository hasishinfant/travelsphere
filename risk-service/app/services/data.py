"""Data acquisition with provider fallbacks. A failing provider is recorded, cached data is used only while it is
still within the source's freshness limit, and missing data is passed on as missing (never as "safe")."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from app.core.config import get_settings
from app.database import repository as repo
from app.ml import hazard_climatology
from app.geospatial.geometry import geodesic_m
from app.ingestion import advisories, elevation, gdacs, open_meteo, osrm, overpass, usgs, warnings
from app.geospatial import settlements
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
              "usgs-earthquakes": 30, "gdacs": 30, "copernicus-dem": 20, "meteoalarm": 30, "nws": 20,
              "us-state-dept-advisories": 30, "fcdo-travel-advice": 20}


_last_failure: dict[str, datetime] = {}


async def _source(source_id: str, coro):
    try:
        result = await asyncio.wait_for(coro, DEADLINE_S.get(source_id, 60))
        _safe_repo(repo.record_source, source_id, True)
        return result, None
    except asyncio.TimeoutError:
        _safe_repo(repo.record_source, source_id, False, "deadline exceeded")
        log.warning("provider %s exceeded its %ss deadline", source_id, DEADLINE_S.get(source_id, 60))
        _last_failure[source_id] = datetime.now(timezone.utc)
        return None, f"{source_id}: no response within {DEADLINE_S.get(source_id, 60)} s"
    except (ProviderError, ValueError, KeyError, TypeError) as e:
        _safe_repo(repo.record_source, source_id, False, str(e))
        _last_failure[source_id] = datetime.now(timezone.utc)
        log.warning("provider %s failed: %s", source_id, e)
        return None, str(e)


async def weather_for(points: list[tuple[float, float]], now: datetime) -> tuple[list[WeatherSnapshot | None], str | None]:
    snaps, err = await _source("open-meteo-forecast", open_meteo.fetch_weather(points, now))
    return (snaps or [None] * len(points)), err


FRESH_MIN = 30          # a provider that answered this recently is served from the saved copy
BACKOFF_MIN = 5         # after a failure, stop making travellers wait for that provider for this long
_refreshing: dict[str, asyncio.Task] = {}


def _recently_ok(source_id: str, now: datetime) -> bool:
    last = _safe_repo(repo.source_last_success, source_id)
    return bool(last) and (now - last) < timedelta(minutes=FRESH_MIN)


def _backing_off(source_id: str, now: datetime) -> bool:
    last = _last_failure.get(source_id)
    return bool(last) and (now - last) < timedelta(minutes=BACKOFF_MIN)


def _usable_saved_copy(source_id: str, now: datetime) -> bool:
    """The saved events are still trustworthy: last success within twice the source's freshness limit."""
    last = _safe_repo(repo.source_last_success, source_id)
    return bool(last) and (now - last) < timedelta(minutes=SOURCES[source_id].max_age_minutes * 2)


async def _cached_ok():
    return None, None


def _refresh_in_background(source_id: str, fetch) -> None:
    """Fetch the provider again without anyone waiting; saves the events and the source's health."""
    task = _refreshing.get(source_id)
    if task is not None and not task.done():
        return

    async def run():
        evs, _ = await _source(source_id, fetch())
        if evs is not None:
            _safe_repo(repo.upsert_hazards, evs)
            _safe_repo(repo.retire_missing_current, source_id, [e.external_id for e in evs])
    try:
        _refreshing[source_id] = asyncio.get_running_loop().create_task(run())
    except RuntimeError:
        pass


async def active_hazards(lat: float, lon: float, search_radius_m: float, now: datetime
                         ) -> tuple[list[HazardEvent] | None, list[str], list[str], list[dict]]:
    """Active hazards near a point from GDACS + USGS (+ configured zones). Returns (events|None, ok, failed, checks)."""
    fetchers = {"gdacs": lambda: gdacs.fetch_current(now), "usgs-earthquakes": lambda: usgs.fetch_recent(now)}
    # Stale-while-revalidate: a provider that answered within FRESH_MIN is served from the saved events at once and
    # refreshed in the background, so one slow public server (GDACS can take minutes) never stalls an assessment.
    # A provider that failed in the last few minutes is not waited for again: its saved copy is used while still
    # trustworthy, otherwise it is reported unavailable at once; either way it keeps being retried in the background.
    fresh = {sid: _recently_ok(sid, now) or (_backing_off(sid, now) and _usable_saved_copy(sid, now)) for sid in fetchers}
    down = {sid: not fresh[sid] and _backing_off(sid, now) for sid in fetchers}
    results = await asyncio.gather(*(_cached_ok() if fresh[sid] or down[sid] else _source(sid, f())
                                     for sid, f in fetchers.items()))
    ok, failed = [], []
    events: list[HazardEvent] = []
    for (sid, (evs, err)) in zip(fetchers, results):
        if down[sid]:
            failed.append(sid)
            _refresh_in_background(sid, fetchers[sid])
            continue
        if fresh[sid]:
            ok.append(sid)
            events += _safe_repo(repo.cached_active_hazards, sid, lat, lon, search_radius_m,
                                 SOURCES[sid].max_age_minutes * 2, default=[]) or []
            _refresh_in_background(sid, fetchers[sid])
            continue
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
    try:  # outlines are a refinement: never let a slow GDACS hold the assessment
        await asyncio.wait_for(asyncio.gather(*(gdacs.fetch_footprint(e) for e in need), return_exceptions=True), 15)
    except asyncio.TimeoutError:
        log.warning("GDACS footprints: gave up after 15 s; using event centres")

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


async def facilities_near(lat: float, lon: float, radius_m: int, background: bool = False
                          ) -> tuple[list[Facility] | None, str | None]:
    """Emergency facilities from the 30-day cache, else Overpass. `background=True` (warm-up job) waits minutes
    instead of seconds, so interactive assessments find the cache already filled."""
    cached = _safe_repo(repo.cached_facilities, lat, lon, radius_m)
    if cached is not None:
        return cached, None
    if background:
        try:
            found, err = await asyncio.wait_for(overpass.fetch_facilities(lat, lon, radius_m, timeout_s=150), 480), None
        except (asyncio.TimeoutError, ProviderError) as e:
            found, err = None, f"overpass: {e or 'no response'}"
    else:
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


async def terrain_for(points: list[tuple[float, float]]) -> tuple[list[dict] | None, str | None]:
    """DEM samples (centre + 300 m and 1 km rings) for each point; (None, error) when the elevation API fails."""
    return await _source("copernicus-dem", elevation.terrain_samples(points))


def remoteness_for(points: list[tuple[float, float]]) -> dict:
    """Nearest town (≥ 5 000 people) and settlement (≥ 1 000) from the point farthest from a town."""
    if not settlements.available():
        return {"error": "GeoNames settlement file not installed (risk-service/data/geonames/cities1000.zip)"}
    worst = None
    for lat, lon in points:
        town = settlements.nearest(lat, lon, 5_000)
        if town and (worst is None or town["distance_m"] > worst[1]["distance_m"]):
            worst = ((lat, lon), town)
    if worst is None:
        return {"error": "No town found in GeoNames"}
    (lat, lon), town = worst
    return {"town": town, "settlement": settlements.nearest(lat, lon, 1_000),
            "point": {"lat": round(lat, 4), "lon": round(lon, 4)}}


async def official_warnings(dest: Destination, now: datetime) -> tuple[list[HazardEvent] | None, str | None, str | None]:
    """(warnings | None on failure, source id | None when the destination has no warning source, note)."""
    sid = warnings.source_for(dest)
    if sid is None:
        return [], None, warnings.NOT_COVERED.get(dest.id, "No official warning feed configured for this destination")
    found, err = await _source(sid, warnings.fetch_warnings(dest, now))
    return found, sid, err


def merge_warnings(hz: tuple, found: list[HazardEvent] | None, sid: str | None, note: str | None) -> tuple:
    """Add official warnings to the active-hazard tuple (events, ok, failed, checks) from active_hazards()."""
    events, ok, failed, checks = hz
    if sid is None:
        return hz
    if found is None:
        return events, ok, failed + [sid], checks
    return (events or []) + found, ok + [sid], failed, checks


async def advisory_for(country: str | None) -> dict:
    """Official travel advice for the country (US State Dept + UK FCDO), the more cautious of the two."""
    if not country:
        return {"available": False, "value": None, "sources": [], "explanation": "Country unknown"}
    (s, s_err), (f, f_err) = await asyncio.gather(_source("us-state-dept-advisories", advisories.state_dept(country)),
                                                  _source("fcdo-travel-advice", advisories.fcdo(country)))
    out = advisories.combine([p for p in (s, f) if p])
    errs = [e for e in (s_err, f_err) if e]
    if errs:
        out["errors"] = errs
        if not out["available"]:
            out["explanation"] = "Official travel advice unavailable (" + "; ".join(errs) + ")"
    return out
