"""USGS Earthquake Hazards Program adapter (public domain).

Active hazards: the "M4.5+ past 7 days" feed. An earthquake is treated as active for 7 days after origin time —
the window of the USGS weekly feed and of the first period of USGS aftershock forecasts.

Severity class: the USGS PAGER alert when issued (green/yellow/orange/red → minor/moderate/severe/extreme), else
the USGS magnitude class descriptors: light 4–4.9 → minor, moderate 5–5.9 → moderate, strong 6–6.9 → severe,
major/great ≥ 7 → extreme.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from shapely.geometry import Point

from app.core.config import get_settings
from app.geospatial.geometry import valid_coordinate
from app.ingestion.http import get_http
from app.schemas.domain import HazardEvent

SOURCE = "usgs-earthquakes"
PAGER_CLASS = {"green": "minor", "yellow": "moderate", "orange": "severe", "red": "extreme"}
ACTIVE_DAYS = 7


def magnitude_class(m: float) -> str:
    return "extreme" if m >= 7 else "severe" if m >= 6 else "moderate" if m >= 5 else "minor" if m >= 4 else "none"


def parse_feature(f: dict, retrieved_at: datetime, active: bool) -> HazardEvent | None:
    p = f.get("properties") or {}
    c = (f.get("geometry") or {}).get("coordinates") or []
    mag = p.get("mag")
    if len(c) < 2 or not isinstance(mag, (int, float)) or not isinstance(p.get("time"), (int, float)):
        return None
    lon, lat = float(c[0]), float(c[1])
    if not valid_coordinate(lat, lon):
        return None
    t = datetime.fromtimestamp(p["time"] / 1000, tz=timezone.utc)
    alert = (p.get("alert") or "").lower() or None
    sev = PAGER_CLASS.get(alert, magnitude_class(float(mag))) if alert else magnitude_class(float(mag))
    updated = datetime.fromtimestamp(p["updated"] / 1000, tz=timezone.utc) if isinstance(p.get("updated"), (int, float)) else t
    return HazardEvent(
        source_id=SOURCE, external_id=str(f.get("id")), hazard_type="earthquake",
        title=str(p.get("title") or f"M{mag} earthquake")[:300], severity_class=sev, alert_level=alert,
        severity_value=float(mag), severity_unit=p.get("magType") or "M",
        severity_text=f"Magnitude {mag}" + (f", depth {c[2]:.0f} km" if len(c) > 2 and c[2] is not None else "")
                      + (f", PAGER {alert}" if alert else "") + (", tsunami flag" if p.get("tsunami") == 1 else ""),
        latitude=lat, longitude=lon, geometry=Point(lon, lat), geometry_kind="point",
        valid_from=t, valid_to=t + timedelta(days=ACTIVE_DAYS), is_current=active, verified=p.get("status") == "reviewed",
        observed_at=updated, retrieved_at=retrieved_at, url=p.get("url"),
        raw={"mag": mag, "mmi": p.get("mmi"), "felt": p.get("felt"), "tsunami": p.get("tsunami"), "status": p.get("status")},
    )


async def fetch_recent(now: datetime | None = None) -> list[HazardEvent]:
    now = now or datetime.now(timezone.utc)
    res = await get_http().get_json(SOURCE, f"{get_settings().usgs_feed_url}/4.5_week.geojson", ttl_s=5 * 60)
    out = []
    for f in (res.data or {}).get("features") or []:
        ev = parse_feature(f, res.retrieved_at, active=True)
        if ev and ev.valid_to and ev.valid_to >= now:
            out.append(ev)
    return out


async def fetch_history(lat: float, lon: float, radius_km: float, start: datetime, end: datetime,
                        min_magnitude: float = 5.0) -> list[HazardEvent]:
    params = {"format": "geojson", "latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}",
              "maxradiuskm": f"{radius_km:.0f}", "starttime": start.date().isoformat(),
              "endtime": end.date().isoformat(), "minmagnitude": min_magnitude, "orderby": "time", "limit": 2000}
    res = await get_http().get_json(SOURCE, get_settings().usgs_fdsn_url, params, ttl_s=7 * 86400)
    return [e for f in (res.data or {}).get("features") or [] if (e := parse_feature(f, res.retrieved_at, active=False))]
