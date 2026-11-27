"""Factor 7 — Access to emergency care (dimension: response capacity).

Literature: safety infrastructure was the dominant criterion (weight 0.53) in the AHP study of a disaster-resilient
tourism app (Glorioso & Palaoag 2026); health risk was the most salient travel risk in Mawby & Ozascilar (2024).

Inputs: OpenStreetMap hospitals/clinics (Overpass, cached) and OSRM driving time from the worst-served point (the
destination, or the route point farthest from a hospital) to its nearest hospitals; straight-line × 1.3 at 40 km/h
when routing is unavailable (labelled lower precision). Computed in journey_context/accessibility.py.
Bands (scoring config): ≤ 60 min adequate (trauma "golden hour" convention), ≤ 120 min limited (Lancet Commission on
Global Surgery 2-hour benchmark), else poor.
Class: adequate → none, limited → minor, poor → moderate. Capped at moderate: slow access to care makes a hazard
worse, it is not a hazard itself. Value = the class value; minutes are the raw value.
"No hospital mapped" means none in OpenStreetMap within the search radius — OSM completeness varies by country.
"""
from __future__ import annotations

from app.risk_engine.context import AssessmentContext
from app.schemas.factors import FACTOR_LABELS, SEVERITY_VALUE, DataQuality, FactorResult, unavailable

KEY = "emergency_access"
METHOD = ("Driving time from the worst-served point to the nearest mapped hospital/clinic (OSRM, else straight-line "
          "× 1.3 at 40 km/h): ≤ 60 min none, ≤ 120 min minor, else moderate.")
CLASS_OF = {"adequate": "none", "limited": "minor", "poor": "moderate"}


def compute(ctx: AssessmentContext) -> FactorResult:
    now = ctx.now
    a = ctx.access
    if not a or a.get("class") not in CLASS_OF:
        why = (a or {}).get("explanation") or "Emergency facility data unavailable"
        return unavailable(KEY, METHOD, why, now)
    cls = CLASS_OF[a["class"]]
    precise = a.get("precision") == "osrm-routed"
    sources = ["overpass"] + (["osrm"] if precise else [])
    notes = ["OpenStreetMap completeness varies by country"]
    if a.get("precision") == "straight-line estimate":
        notes.append("Drive time estimated from straight-line distance (routing unavailable)")
    return FactorResult(
        key=KEY, label=FACTOR_LABELS[KEY], status="measured", value=SEVERITY_VALUE[cls], severity_class=cls,
        raw_value=a.get("minutes_to_care"), unit="minutes to nearest hospital/clinic",
        inputs={k: a.get(k) for k in ("class", "minutes_to_care", "precision", "counts", "nearest_hospital",
                                       "worst_point", "search_radius_m")},
        methodology=METHOD, explanation=a.get("explanation", ""), computed_at=now,
        data_quality=DataQuality(sources=sources, geographic_precision_m=None if precise else 5_000, notes=notes),
    )
