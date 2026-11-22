"""Response accessibility: how far help is from the worst-served point of the journey.

Inputs: OSM hospitals/clinics/police/fire stations (Overpass) and, when available, OSRM driving time from the
worst-served point to its nearest hospitals.
Worst-served point: the route sample point whose nearest hospital is farthest (straight line).
Bands (scoring config): ≤ 60 min adequate (trauma "golden hour" convention), ≤ 120 min limited (Lancet Commission on
Global Surgery 2-hour benchmark), else poor. Without a routed time the drive time is estimated as straight-line
distance × 1.3 road-circuity factor at 40 km/h (lower precision, labelled). "No hospital mapped" means none in
OpenStreetMap within the search radius — OSM completeness varies by country.
"""
from __future__ import annotations

from shapely.geometry import LineString, Point

from app.geospatial.geometry import geodesic_m, sample_line
from app.schemas.domain import Facility

CIRCUITY = 1.3
FALLBACK_KMH = 40


def worst_served_point(subject, hospitals: list[Facility], samples: int = 25) -> tuple[Point, float | None]:
    pts = sample_line(subject, samples) if isinstance(subject, LineString) else [subject]
    if not hospitals:
        return pts[0], None
    worst, worst_d = pts[0], -1.0
    for p in pts:
        d = min(geodesic_m(p.y, p.x, h.latitude, h.longitude) for h in hospitals)
        if d > worst_d:
            worst, worst_d = p, d
    return worst, worst_d


def nearest(point: Point, facilities: list[Facility], k: int = 3) -> list[tuple[Facility, float]]:
    ranked = sorted(((f, geodesic_m(point.y, point.x, f.latitude, f.longitude)) for f in facilities), key=lambda x: x[1])
    return ranked[:k]


def classify(minutes: float | None, bands: dict) -> str:
    if minutes is None:
        return "unknown"
    return "adequate" if minutes <= bands["adequate"] else "limited" if minutes <= bands["limited"] else "poor"


def assess_access(subject, facilities: list[Facility] | None, drive_minutes: list[float | None] | None,
                  bands: dict, search_radius_m: int, error: str | None = None) -> dict:
    if facilities is None:
        return {"class": "unknown", "explanation": f"Emergency facility data unavailable ({error or 'Overpass did not respond'})",
                "source": "overpass", "precision": None}
    hospitals = [f for f in facilities if f.kind in ("hospital", "clinic")]
    counts = {k: sum(f.kind == k for f in facilities) for k in ("hospital", "clinic", "police", "fire_station")}
    point, straight = worst_served_point(subject, hospitals)
    if straight is None:
        return {"class": "poor", "counts": counts, "nearest_hospital": None, "search_radius_m": search_radius_m,
                "explanation": f"No hospital or clinic mapped in OpenStreetMap within {search_radius_m / 1000:.0f} km",
                "source": "overpass", "precision": "osm-coverage-dependent"}
    near = nearest(point, hospitals)
    routed = [m for m in (drive_minutes or []) if m is not None]
    if routed:
        minutes, precision = min(routed), "osrm-routed"
    else:
        minutes, precision = straight / 1000 * CIRCUITY / FALLBACK_KMH * 60, "straight-line estimate"
    cls = classify(minutes, bands)
    name = near[0][0].name or near[0][0].kind
    text = (f"Nearest hospital/clinic from the least-served point: {name}, {near[0][1] / 1000:.1f} km "
            f"(~{minutes:.0f} min by road, {precision}); {counts['hospital']} hospitals, {counts['police']} police and "
            f"{counts['fire_station']} fire stations mapped nearby")
    return {"class": cls, "minutes_to_care": round(minutes, 1), "precision": precision, "counts": counts,
            "nearest_hospital": {"name": near[0][0].name, "distance_m": round(near[0][1]),
                                 "lat": near[0][0].latitude, "lon": near[0][0].longitude},
            "worst_point": {"lat": round(point.y, 4), "lon": round(point.x, 4)},
            "search_radius_m": search_radius_m, "explanation": text, "source": "overpass"}
