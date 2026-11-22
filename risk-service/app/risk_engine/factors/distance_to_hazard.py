"""Factor 3 — Distance to hazard.

Input: geometry of the subject (destination point, traveller location or journey route) and the geometries of all
active hazards in the search area (footprint polygons where available, else centroids).
Calculation: minimum geodesic/AEQD distance in metres (0 = inside the footprint), via Shapely + PyProj.
Normalisation: proximity = 1 − min(d, R)/R, where R is the destination's assessment radius (a scope parameter,
default 50 km): 1 inside a footprint, 0 at or beyond R. This is a linear baseline, not a decay law fitted to data.
A distance is a measurement, not a severity, so no severity class is assigned.
"""
from __future__ import annotations

from app.geospatial.geometry import distance_m
from app.risk_engine.context import AssessmentContext
from app.schemas.factors import FACTOR_LABELS, DataQuality, FactorResult, unavailable

KEY = "distance_to_hazard"
METHOD = ("Minimum geodesic distance from the subject to any active hazard geometry (footprint or centroid); "
          "proximity = 1 − min(d, R)/R with R = assessment radius.")


def compute(ctx: AssessmentContext) -> FactorResult:
    now = ctx.now
    if ctx.hazards is None:
        return unavailable(KEY, METHOD, "Hazard locations unavailable — distance cannot be computed", now)
    active = [h for h in ctx.hazards if h.active_during(ctx.window_start, ctx.window_end)]
    subject = ctx.subject
    nearest = None
    for h in active:
        d = distance_m(subject, h.geometry)
        if nearest is None or d < nearest[1]:
            nearest = (h, d)
    R = ctx.radius_m
    if nearest is None:
        return FactorResult(key=KEY, label=FACTOR_LABELS[KEY], status="measured", value=0.0, unit="m", raw_value=None,
                            inputs={"assessment_radius_m": R, "hazards_considered": 0},
                            methodology=METHOD, explanation="No active hazard in the search area",
                            computed_at=now, data_quality=DataQuality(sources=ctx.hazard_sources_ok))
    h, d = nearest
    proximity = 1 - min(d, R) / R
    shape = "footprint" if h.has_footprint else "reported centre (no footprint published)"
    target = "route" if ctx.mode == "journey" and ctx.route else "location"
    text = (f"Inside the {h.title} footprint" if d == 0
            else f"{h.title} is {d / 1000:.1f} km from the {target} (measured to its {shape})")
    return FactorResult(
        key=KEY, label=FACTOR_LABELS[KEY], status="measured", value=round(proximity, 4), raw_value=round(d), unit="m",
        inputs={"nearest_hazard": f"{h.source_id}:{h.external_id}", "hazard_type": h.hazard_type,
                "measured_to": "footprint" if h.has_footprint else "centroid", "assessment_radius_m": R,
                "hazards_considered": len(active)},
        methodology=METHOD, explanation=text, observed_at=h.observed_at, computed_at=now,
        data_quality=DataQuality(sources=[h.source_id], observed_at=h.observed_at,
                                 geographic_precision_m=None if h.has_footprint else 10_000,
                                 notes=[] if h.has_footprint else ["Point location only — true extent unknown"]),
    )
