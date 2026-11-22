"""OSRM routing (OpenStreetMap data). The public demo servers have no SLA and a fair-use policy; set
OSRM_DRIVING_URL / OSRM_FOOT_URL to a self-hosted OSRM for production.

If routing fails, a straight-line (great-circle segments) route is returned and labelled as such: it is good enough
to test proximity to large footprints, but exposure along real roads may differ.
"""
from __future__ import annotations

from shapely.geometry import LineString

from app.core.config import get_settings
from app.geospatial.geometry import length_m
from app.ingestion.http import ProviderError, get_http
from app.schemas.domain import Route

SOURCE = "osrm"
# Typical speeds used ONLY for the straight-line fallback duration estimate
FALLBACK_SPEED_MS = {"driving": 40 / 3.6, "foot": 4.5 / 3.6}


def _base(profile: str) -> tuple[str, str]:
    s = get_settings()
    return (s.osrm_foot_url, "foot") if profile == "foot" else (s.osrm_driving_url, "driving")


async def fetch_routes(waypoints: list[tuple[float, float]], profile: str = "driving",
                       alternatives: bool = True) -> list[Route]:
    """Primary route first, then alternatives. waypoints are (lat, lon)."""
    base, prof = _base(profile)
    coords = ";".join(f"{lon:.5f},{lat:.5f}" for lat, lon in waypoints)
    params = {"overview": "full", "geometries": "geojson", "steps": "false",
              "alternatives": "true" if alternatives and len(waypoints) == 2 else "false"}
    res = await get_http().get_json(SOURCE, f"{base}/route/v1/{prof}/{coords}", params, ttl_s=6 * 3600)
    body = res.data or {}
    if body.get("code") != "Ok" or not body.get("routes"):
        raise ProviderError(SOURCE, f"no route ({body.get('code')})")
    routes = []
    for r in body["routes"]:
        pts = (r.get("geometry") or {}).get("coordinates") or []
        if len(pts) < 2:
            continue
        routes.append(Route(geometry=LineString(pts), distance_m=float(r["distance"]), duration_s=float(r["duration"]),
                            profile=prof, source="osrm"))
    if not routes:
        raise ProviderError(SOURCE, "route without geometry")
    return routes


def straight_line(waypoints: list[tuple[float, float]], profile: str = "driving") -> Route:
    line = LineString([(lon, lat) for lat, lon in waypoints]) if len(waypoints) > 1 \
        else LineString([(waypoints[0][1], waypoints[0][0]), (waypoints[0][1] + 1e-6, waypoints[0][0])])
    d = length_m(line)
    return Route(geometry=line, distance_m=d, duration_s=d / FALLBACK_SPEED_MS.get(profile, FALLBACK_SPEED_MS["driving"]),
                 profile=profile, source="straight-line",
                 precision_note="Routing unavailable — straight-line segments between waypoints; road exposure may differ")


async def driving_minutes(origin: tuple[float, float], targets: list[tuple[float, float]]) -> list[float | None]:
    """Driving time (minutes) from origin to each target via the OSRM table service."""
    if not targets:
        return []
    base, _ = _base("driving")
    coords = ";".join(f"{lon:.5f},{lat:.5f}" for lat, lon in [origin, *targets])
    res = await get_http().get_json(SOURCE, f"{base}/table/v1/driving/{coords}",
                                    {"sources": "0", "annotations": "duration"}, ttl_s=24 * 3600)
    row = ((res.data or {}).get("durations") or [[None]])[0][1:]
    return [None if v is None else v / 60 for v in row]
