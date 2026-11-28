"""Data-quality checks shared by all factors: credibility, freshness, completeness, precision, duplicates and
cross-source agreement. Mirrors the `data_sources` table (seeded in migration 0004)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from app.geospatial.geometry import geodesic_m
from app.schemas.domain import HazardEvent


@dataclass(frozen=True)
class SourceInfo:
    id: str
    tier: str              # official | scientific | community | configured
    max_age_minutes: int   # older than this → stale


SOURCES: dict[str, SourceInfo] = {s.id: s for s in [
    SourceInfo("open-meteo-forecast", "scientific", 90),
    SourceInfo("open-meteo-archive", "scientific", 525_600),
    SourceInfo("open-meteo-geocoding", "community", 525_600),
    SourceInfo("gdacs", "official", 180),
    SourceInfo("usgs-earthquakes", "official", 60),
    SourceInfo("osrm", "community", 10_080),
    SourceInfo("overpass", "community", 43_200),
    SourceInfo("travelsphere-incidents", "community", 525_600),
    SourceInfo("travelsphere-config", "configured", 525_600),
    SourceInfo("copernicus-dem", "scientific", 5_256_000),    # Copernicus DEM GLO-90 via the Open-Meteo elevation API
    SourceInfo("geonames", "community", 525_600),             # GeoNames cities1000 (CC BY 4.0)
    SourceInfo("meteoalarm", "official", 60),                 # national weather-service warnings (EUMETNET)
    SourceInfo("nws", "official", 30),                        # US National Weather Service alerts
    SourceInfo("us-state-dept-advisories", "official", 10_080),
    SourceInfo("fcdo-travel-advice", "official", 10_080),
]}

# Ordinal credibility of each tier (documented convention used only by the confidence measure):
# official agency alert > peer-reviewed numerical model > open community data > editorial configuration.
TIER_SCORE = {"official": 1.0, "scientific": 0.85, "community": 0.65, "configured": 0.4}


def age_minutes(observed_at: datetime | None, now: datetime) -> float | None:
    return None if observed_at is None else max(0.0, (now - observed_at).total_seconds() / 60)


def freshness_score(source_id: str, observed_at: datetime | None, now: datetime) -> tuple[float | None, bool]:
    """1.0 while within the source's max age, then linear decay to 0 at twice the max age. Returns (score, stale)."""
    info = SOURCES.get(source_id)
    age = age_minutes(observed_at, now)
    if info is None or age is None:
        return None, False
    if age <= info.max_age_minutes:
        return 1.0, False
    return max(0.0, 1 - (age - info.max_age_minutes) / info.max_age_minutes), True


def is_stale(source_id: str, observed_at: datetime | None, now: datetime) -> bool:
    return freshness_score(source_id, observed_at, now)[1]


# ------------------------------------------------------------------ hazards: duplicates and agreement
EQ_MATCH_SECONDS = 180
EQ_MATCH_METRES = 100_000
MAGNITUDE_TOLERANCE = 0.3   # typical spread between agencies' magnitude estimates for the same event


def _eq_match(a: HazardEvent, b: HazardEvent) -> bool:
    return (abs((a.valid_from - b.valid_from).total_seconds()) <= EQ_MATCH_SECONDS
            and geodesic_m(a.latitude, a.longitude, b.latitude, b.longitude) <= EQ_MATCH_METRES)


def merge_duplicate_hazards(events: list[HazardEvent]) -> tuple[list[HazardEvent], list[dict]]:
    """The same earthquake is reported by USGS and GDACS. Keep one record per physical event:
    the GDACS record (it carries a footprint and the alert used for overrides) enriched with the USGS magnitude/PAGER,
    and record whether the two sources agree on severity class. Exact duplicates (same source + id) are dropped.
    Returns (deduplicated events, agreement checks)."""
    seen: set[tuple[str, str]] = set()
    unique: list[HazardEvent] = []
    for e in events:
        k = (e.source_id, e.external_id)
        if k not in seen:
            seen.add(k)
            unique.append(e)

    gdacs_eq = [e for e in unique if e.source_id == "gdacs" and e.hazard_type == "earthquake"]
    usgs_eq = [e for e in unique if e.source_id == "usgs-earthquakes"]
    checks: list[dict] = []
    drop: set[int] = set()
    for u in usgs_eq:
        match = next((g for g in gdacs_eq if _eq_match(g, u)), None)
        if match is None:
            continue
        # Compare the same physical quantity (magnitude). GDACS alert levels measure humanitarian impact, USGS
        # classes measure magnitude/PAGER — those are different scales and are not expected to coincide.
        gm, um = match.severity_value, u.severity_value
        agree = None if gm is None or um is None else abs(gm - um) <= MAGNITUDE_TOLERANCE
        if agree is not None:
            checks.append({"event": u.title, "sources": ["usgs-earthquakes", "gdacs"], "agree": agree,
                           "usgs_magnitude": um, "gdacs_magnitude": gm, "tolerance": MAGNITUDE_TOLERANCE})
        # Conflict handling: keep the more severe class (precautionary) and say so
        if SEV.index(u.severity_class) > SEV.index(match.severity_class):
            match.severity_class = u.severity_class
            match.severity_text = f"{match.severity_text or ''} (raised to USGS class: {u.severity_text})".strip()
        match.raw["usgs_id"] = u.external_id
        drop.add(id(u))
    return [e for e in unique if id(e) not in drop], checks


SEV = ["none", "minor", "moderate", "severe", "extreme"]


def weather_internal_agreement(code: int | None, precip_mm_h: float | None) -> bool | None:
    """Rain/snow/drizzle weather codes should coincide with non-zero precipitation and vice-versa (heavy rain)."""
    if code is None or precip_mm_h is None:
        return None
    wet_code = 51 <= code <= 67 or 71 <= code <= 86 or code >= 95
    if precip_mm_h >= 2.5 and not wet_code:
        return False
    if code in (63, 65, 81, 82) and precip_mm_h == 0:
        return False
    return True


def within(observed: datetime, now: datetime, minutes: float) -> bool:
    return now - observed <= timedelta(minutes=minutes)
