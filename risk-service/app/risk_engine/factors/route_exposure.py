"""Factor 4 — Route exposure (journeys only).

Inputs: route geometry (OSRM, or straight-line fallback) and footprint polygons of hazards active during travel.
Calculation: GeoPandas overlay of the route with hazard footprints in a local AEQD projection → exposed length (m)
(overlapping footprints counted once), per-hazard exposed length, exposed fraction = exposed / total length, and
exposed duration ≈ route duration × exposed fraction (assumes constant speed along the route).
Value = exposed fraction (0–1). Hazards with only a point location have no extent to intersect; they are reported
under distance_to_hazard instead of being given an invented radius.
"""
from __future__ import annotations

from app.geospatial.geometry import route_hazard_overlay
from app.risk_engine.context import AssessmentContext
from app.schemas.factors import FACTOR_LABELS, DataQuality, FactorResult, not_applicable, unavailable

KEY = "route_exposure"
METHOD = ("Route ∩ active hazard footprints (GeoPandas overlay, local AEQD CRS): exposed length / route length; "
          "exposed duration = route duration × exposed fraction.")


def exposure_of(route, hazards, window_start, window_end) -> dict:
    footprints = [(f"{h.source_id}:{h.external_id}", h.geometry) for h in hazards
                  if h.has_footprint and h.active_during(window_start, window_end)]
    ov = route_hazard_overlay(route.geometry, footprints)
    frac = ov["exposed_m"] / ov["total_m"] if ov["total_m"] else 0.0
    return {"total_m": ov["total_m"], "exposed_m": ov["exposed_m"], "fraction": min(1.0, frac),
            "exposed_minutes": route.duration_s / 60 * min(1.0, frac), "per_hazard_m": ov["per_hazard_m"]}


def compute(ctx: AssessmentContext) -> FactorResult:
    now = ctx.now
    if ctx.mode != "journey":
        return not_applicable(KEY, METHOD, "Route exposure applies to journeys, not to a destination overview", now)
    if ctx.route is None:  # no origin/waypoints: the journey is a stay at the destination
        return not_applicable(KEY, METHOD, "No route given — assessing the stay at the destination", now)
    if ctx.hazards is None:
        return unavailable(KEY, METHOD, "Hazard footprints unavailable — exposure cannot be ruled out", now)
    e = exposure_of(ctx.route, ctx.hazards, ctx.window_start, ctx.window_end)
    titles = {f"{h.source_id}:{h.external_id}": h.title for h in ctx.hazards}
    point_only = [h for h in ctx.hazards if not h.has_footprint and h.active_during(ctx.window_start, ctx.window_end)]
    if e["exposed_m"] > 0:
        named = ", ".join(f"{titles.get(k, k)} ({v / 1000:.1f} km)" for k, v in
                          sorted(e["per_hazard_m"].items(), key=lambda kv: -kv[1])[:3])
        text = (f"{e['exposed_m'] / 1000:.1f} km of the {e['total_m'] / 1000:.1f} km route "
                f"({e['fraction']:.0%}, about {e['exposed_minutes']:.0f} min) passes through: {named}")
    else:
        text = f"The {e['total_m'] / 1000:.1f} km route does not cross any active hazard footprint"
    notes = [ctx.route.precision_note] if ctx.route.precision_note else []
    if point_only:
        notes.append(f"{len(point_only)} active hazard(s) have no published footprint and cannot be intersected")
    return FactorResult(
        key=KEY, label=FACTOR_LABELS[KEY], status="derived", value=round(e["fraction"], 4),
        raw_value=round(e["exposed_m"]), unit="m",
        inputs={"route_length_m": round(e["total_m"]), "route_duration_min": round(ctx.route.duration_s / 60, 1),
                "exposed_fraction": round(e["fraction"], 4), "exposed_minutes": round(e["exposed_minutes"], 1),
                "per_hazard_m": {k: round(v) for k, v in e["per_hazard_m"].items()},
                "route_source": ctx.route.source, "profile": ctx.route.profile},
        methodology=METHOD, explanation=text, computed_at=now,
        data_quality=DataQuality(sources=[ctx.route.source if ctx.route.source == "osrm" else "straight-line", *ctx.hazard_sources_ok],
                                 geographic_precision_m=None if ctx.route.source == "osrm" else 5_000, notes=notes),
    )
