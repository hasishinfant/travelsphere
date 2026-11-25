"""Emergency facilities (hospitals, clinics, police, fire stations) from OpenStreetMap via Overpass.

The public Overpass servers are frequently at capacity, so the adapter tries several mirrors (each with retries and
backoff). Results are cached in the database by the repository layer for 30 days. OSM completeness varies by country;
"no facility found" means none is mapped in OSM, not that none exists — this is reported in the explanation.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.core.config import get_settings
from app.geospatial.geometry import valid_coordinate
from app.ingestion.http import ProviderError, get_http
from app.schemas.domain import Facility

SOURCE = "overpass"
KINDS = {"hospital", "clinic", "police", "fire_station"}


def build_query(lat: float, lon: float, radius_m: int) -> str:
    return (f'[out:json][timeout:25];'
            f'nwr(around:{radius_m},{lat:.5f},{lon:.5f})[amenity~"^(hospital|clinic|police|fire_station)$"];'
            f'out center tags 300;')


def first_phone(tags: dict) -> str | None:
    """The first number of OSM's phone / contact:phone / emergency:phone tags, exactly as mapped (never synthesised)."""
    for k in ("phone", "contact:phone", "emergency:phone"):
        raw = (tags.get(k) or "").split(";")[0].strip()
        if raw and sum(ch.isdigit() for ch in raw) >= 3 and len(raw) <= 64:
            return raw
    return None


def parse(body: dict) -> list[Facility]:
    out = []
    for el in body.get("elements") or []:
        tags = el.get("tags") or {}
        kind = tags.get("amenity")
        lat = el.get("lat", (el.get("center") or {}).get("lat"))
        lon = el.get("lon", (el.get("center") or {}).get("lon"))
        if kind not in KINDS or not valid_coordinate(lat, lon):
            continue
        emergency = tags.get("emergency")
        out.append(Facility(osm_id=f"{el.get('type', 'n')[0]}{el.get('id')}", kind=kind, name=tags.get("name"),
                            latitude=float(lat), longitude=float(lon),
                            has_emergency=True if emergency == "yes" else False if emergency == "no" else None,
                            phone=first_phone(tags), healthcare=(tags.get("healthcare") or None),
                            retrieved_at=datetime.now(timezone.utc)))
    return out


async def fetch_facilities(lat: float, lon: float, radius_m: int) -> list[Facility]:
    query = build_query(lat, lon, radius_m)
    last: Exception | None = None
    for url in get_settings().overpass_urls:
        try:
            # Public mirrors are often saturated: one retry each, bounded time, then the next mirror
            res = await get_http().get_json(SOURCE, url, method="POST", data={"data": query}, ttl_s=24 * 3600,
                                            retries=1, timeout_s=30)
            return parse(res.data or {})
        except ProviderError as e:
            last = e
    raise last or ProviderError(SOURCE, "no Overpass endpoint configured")
