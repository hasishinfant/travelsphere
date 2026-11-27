"""Terrain elevation from the Copernicus DEM GLO-90 (90 m), served by the Open-Meteo elevation API (no key).

`terrain_samples` asks for each sample point plus two rings of neighbours (8 at 300 m, 8 at 1 000 m), so the terrain
factor can derive local slope and relief. Up to 100 coordinates per request (the API limit). Sea cells return 0 m,
which is the real drop at a sea cliff.
"""
from __future__ import annotations

import math

from app.core.config import get_settings
from app.ingestion.http import ProviderError, get_http

SOURCE = "copernicus-dem"
MAX_PER_REQUEST = 100
RINGS_M = (300, 1000)
BEARINGS = tuple(range(0, 360, 45))


def offset(lat: float, lon: float, distance_m: float, bearing_deg: float) -> tuple[float, float]:
    """Destination point on a sphere (R = 6 371 km); error is negligible at ≤ 1 km."""
    r = 6_371_000.0
    d, b = distance_m / r, math.radians(bearing_deg)
    la1, lo1 = math.radians(lat), math.radians(lon)
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(b))
    lo2 = lo1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(la1), math.cos(d) - math.sin(la1) * math.sin(la2))
    return math.degrees(la2), (math.degrees(lo2) + 540) % 360 - 180


def stencil(lat: float, lon: float) -> list[tuple[float, float]]:
    """Centre, then 8 points at 300 m, then 8 at 1 000 m (17 points)."""
    return [(lat, lon)] + [offset(lat, lon, r, b) for r in RINGS_M for b in BEARINGS]


async def fetch_elevations(points: list[tuple[float, float]]) -> list[float | None]:
    out: list[float | None] = []
    for i in range(0, len(points), MAX_PER_REQUEST):
        chunk = points[i:i + MAX_PER_REQUEST]
        res = await get_http().get_json(SOURCE, get_settings().elevation_url, {
            "latitude": ",".join(f"{p[0]:.5f}" for p in chunk),
            "longitude": ",".join(f"{p[1]:.5f}" for p in chunk)}, ttl_s=30 * 86400)
        vals = (res.data or {}).get("elevation")
        if not isinstance(vals, list) or len(vals) != len(chunk):
            raise ProviderError(SOURCE, "elevation response does not match the request")
        out += [float(v) if isinstance(v, (int, float)) and -500 < v < 9000 else None for v in vals]
    return out


async def terrain_samples(points: list[tuple[float, float]]) -> list[dict]:
    """For each point: {'lat', 'lon', 'centre_m', 'ring300_m': [8], 'ring1000_m': [8]}."""
    flat = [p for lat, lon in points for p in stencil(lat, lon)]
    elev = await fetch_elevations(flat)
    out = []
    for i, (lat, lon) in enumerate(points):
        e = elev[i * 17:(i + 1) * 17]
        out.append({"lat": lat, "lon": lon, "centre_m": e[0], "ring300_m": e[1:9], "ring1000_m": e[9:17]})
    return out
