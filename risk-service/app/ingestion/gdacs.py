"""GDACS (Global Disaster Alert and Coordination System, UN OCHA / EC JRC) adapter.

Alert levels are GDACS's own impact-based scale:
  Green  — limited humanitarian impact          → severity class "minor"
  Orange — potential need for national/intl aid → "severe"
  Red    — likely need for international aid    → "extreme"  (eligible for the critical override)

Footprints from /polygons/getgeometry:
  TC: wind buffers Poly_Green ≥60 km/h, Poly_Orange ≥90 km/h, Poly_Red ≥120 km/h. Mapped onto the Beaufort-based
      wind classes used for weather (gale 17.2 m/s → moderate, storm 24.5 → severe, hurricane force 32.7 → extreme).
  FL: Poly_Affected (affected area).  WF: Poly_area (burnt/affected area).
  EQ: Poly_Circle — a generic 100 km circle drawn by GDACS, NOT a shaking footprint (labelled as such).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from shapely.geometry import Point, shape
from shapely.ops import unary_union

from app.core.config import get_settings
from app.geospatial.geometry import valid_coordinate
from app.ingestion.http import ProviderError, get_http
from app.schemas.domain import HazardEvent

SOURCE = "gdacs"
TYPE_MAP = {"EQ": "earthquake", "TC": "cyclone", "FL": "flood", "VO": "volcano", "WF": "wildfire", "DR": "drought"}
ALERT_CLASS = {"green": "minor", "orange": "severe", "red": "extreme"}
TC_WIND_CLASS = {"Poly_Green": ("moderate", "winds ≥ 60 km/h"), "Poly_Orange": ("severe", "winds ≥ 90 km/h"),
                 "Poly_Red": ("extreme", "winds ≥ 120 km/h")}
FOOTPRINT_CLASSES = {"FL": {"Poly_Affected"}, "WF": {"Poly_area"}, "EQ": {"Poly_Circle"}, "VO": {"Poly_Circle", "Poly_area"},
                     "DR": {"Poly_Affected", "Poly_area"}}
PAGE_SIZE = 100


def _dt(v: Any) -> datetime | None:
    if not isinstance(v, str) or len(v) < 10:
        return None
    try:
        d = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)  # GDACS timestamps are UTC


def parse_event(feature: dict, retrieved_at: datetime) -> HazardEvent | None:
    p = feature.get("properties") or {}
    etype = p.get("eventtype")
    coords = (feature.get("geometry") or {}).get("coordinates") or []
    if etype not in TYPE_MAP or len(coords) < 2:
        return None
    lon, lat = float(coords[0]), float(coords[1])
    alert = str(p.get("alertlevel") or "").lower()
    start, end = _dt(p.get("fromdate")), _dt(p.get("todate"))
    if not valid_coordinate(lat, lon) or alert not in ALERT_CLASS or start is None:
        return None
    current = str(p.get("iscurrent")).lower() == "true"
    if end is not None and end < start:  # provider data error seen in the archive: repair, never invert the period
        end = start
    sev = p.get("severitydata") or {}
    return HazardEvent(
        source_id=SOURCE, external_id=f"{etype}-{p.get('eventid')}", hazard_type=TYPE_MAP[etype],
        title=str(p.get("name") or p.get("description") or f"{TYPE_MAP[etype]} event")[:300],
        severity_class=ALERT_CLASS[alert], alert_level=alert,
        severity_value=sev.get("severity") if isinstance(sev.get("severity"), (int, float)) else None,
        severity_unit=sev.get("severityunit"), severity_text=sev.get("severitytext"),
        latitude=lat, longitude=lon, geometry=Point(lon, lat), geometry_kind="point",
        valid_from=start, valid_to=None if current else (end or start), is_current=current, verified=True,
        observed_at=_dt(p.get("datemodified")) or end or start, retrieved_at=retrieved_at,
        country=p.get("country"), url=(p.get("url") or {}).get("report"),
        raw={"eventtype": etype, "eventid": p.get("eventid"), "episodeid": p.get("episodeid"),
             "alertscore": p.get("alertscore"), "geometry_url": (p.get("url") or {}).get("geometry")},
    )


def apply_footprint(event: HazardEvent, collection: dict) -> HazardEvent:
    etype = event.raw.get("eventtype")
    zones: list[tuple[str, Any, str]] = []
    footprint = []
    for f in collection.get("features") or []:
        cls = (f.get("properties") or {}).get("Class")
        g = f.get("geometry")
        if not g or g.get("type") not in ("Polygon", "MultiPolygon"):
            continue
        try:
            geom = shape(g)
        except (ValueError, TypeError, AttributeError):
            continue
        if not geom.is_valid:
            geom = geom.buffer(0)
        if etype == "TC" and cls in TC_WIND_CLASS:
            zones.append((TC_WIND_CLASS[cls][0], geom, TC_WIND_CLASS[cls][1]))
            footprint.append(geom)
        elif cls in FOOTPRINT_CLASSES.get(etype, set()):
            footprint.append(geom)
    if footprint:
        event.geometry = unary_union(footprint)
        event.geometry_kind = "polygon"
        if zones:  # merge forecast-time slices per wind class
            merged: dict[str, tuple[Any, str]] = {}
            for c, g, label in zones:
                merged[c] = (unary_union([merged[c][0], g]) if c in merged else g, label)
            event.zones = [(c, g, label) for c, (g, label) in merged.items()]
        event.footprint_note = {"TC": "GDACS wind buffers (observed + forecast track)",
                                "EQ": "GDACS generic 100 km circle — not a shaking footprint",
                                "FL": "GDACS affected area", "WF": "GDACS affected area"}.get(etype, "GDACS polygon")
    return event


async def fetch_events(start: datetime, end: datetime, alert_levels: str = "Green;Orange;Red",
                       event_types: str = "EQ;TC;FL;VO;WF;DR", max_pages: int = 20) -> list[HazardEvent]:
    url = f"{get_settings().gdacs_url}/events/geteventlist/SEARCH"
    events: dict[str, HazardEvent] = {}
    for page in range(1, max_pages + 1):
        params = {"eventlist": event_types, "fromDate": start.date().isoformat(), "toDate": end.date().isoformat(),
                  "alertlevel": alert_levels, "pagenumber": page, "pageSize": PAGE_SIZE}
        res = await get_http().get_json(SOURCE, url, params, ttl_s=15 * 60)
        feats = (res.data or {}).get("features") or []
        for f in feats:
            ev = parse_event(f, res.retrieved_at)
            # several episodes of one event: keep the most recently modified
            if ev and (ev.external_id not in events or ev.observed_at >= events[ev.external_id].observed_at):
                events[ev.external_id] = ev
        if len(feats) < PAGE_SIZE:
            break
    return list(events.values())


async def fetch_current(now: datetime | None = None) -> list[HazardEvent]:
    now = now or datetime.now(timezone.utc)
    # Long-running events (droughts, floods) can have started months ago
    return [e for e in await fetch_events(now - timedelta(days=180), now + timedelta(days=1)) if e.is_current]


async def fetch_footprint(event: HazardEvent) -> HazardEvent:
    url = event.raw.get("geometry_url")
    if not url:
        return event
    try:
        res = await get_http().get_json(SOURCE, url, ttl_s=60 * 60)
    except ProviderError:
        event.footprint_note = "GDACS footprint unavailable — centroid only"
        return event
    return apply_footprint(event, res.data or {})
