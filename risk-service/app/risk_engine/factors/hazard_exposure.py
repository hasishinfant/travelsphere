"""Factor 3 — Hazard exposure (dimension: exposure). Replaces the former "distance to hazard" and "route exposure"
factors, which measured the same thing (is the traveller in or near an active hazard?) for points and routes.

Inputs: the subject (destination point, traveller location or journey route) and the geometries of active hazards
(footprint polygons where published, else reported centres) during the assessed period.
Calculation (Shapely + PyProj, local AEQD projection):
  proximity      = 1 − min(d, R)/R, d = geodesic distance to the nearest active hazard geometry, R = assessment
                   radius (scope parameter, default 50 km). 1 inside a footprint, 0 at or beyond R. Linear baseline.
  exposed share  = for journeys with a route: route length inside active footprints / route length; exposed minutes
                   = route duration × share (constant-speed assumption). Overlapping footprints are counted once.
Value = max(proximity, exposed share).
Class: exposure is a modifier of a hazard, not a hazard itself, so this factor carries NO severity class. The hazard's
own severity where the traveller is (factor 2) already applies only when the footprint touches the subject; this
factor says how close and for how long.
Hazards with only a point location have no extent to intersect: they count for proximity, never for exposed length.
"""
from __future__ import annotations

from app.geospatial.geometry import distance_m, route_hazard_overlay
from app.risk_engine.context import AssessmentContext
from app.schemas.factors import FACTOR_LABELS, DataQuality, FactorResult, unavailable

KEY = "hazard_exposure"
METHOD = ("max(proximity, exposed route share): proximity = 1 − min(d, R)/R to the nearest active hazard geometry; "
          "exposed share = route ∩ active footprints / route length (GeoPandas overlay, local AEQD CRS).")


def exposure_of(route, hazards, window_start, window_end) -> dict:
    footprints = [(f"{h.source_id}:{h.external_id}", h.geometry) for h in hazards
                  if h.has_footprint and h.active_during(window_start, window_end)]
    ov = route_hazard_overlay(route.geometry, footprints)
    frac = ov["exposed_m"] / ov["total_m"] if ov["total_m"] else 0.0
    return {"total_m": ov["total_m"], "exposed_m": ov["exposed_m"], "fraction": min(1.0, frac),
            "exposed_minutes": route.duration_s / 60 * min(1.0, frac), "per_hazard_m": ov["per_hazard_m"]}


def compute(ctx: AssessmentContext) -> FactorResult:
    now = ctx.now
    if ctx.hazards is None:
        return unavailable(KEY, METHOD, "Hazard locations unavailable — exposure cannot be ruled out", now)
    active = [h for h in ctx.hazards if h.active_during(ctx.window_start, ctx.window_end)]
    R = ctx.radius_m
    subject = ctx.subject
    nearest = min(((h, distance_m(subject, h.geometry)) for h in active), key=lambda x: x[1], default=None)
    proximity = 0.0 if nearest is None else 1 - min(nearest[1], R) / R

    route_part = None
    if ctx.mode == "journey" and ctx.route is not None:
        route_part = exposure_of(ctx.route, ctx.hazards, ctx.window_start, ctx.window_end)
    share = route_part["fraction"] if route_part else 0.0
    value = max(proximity, share)

    target = "route" if route_part else "location"
    parts = []
    if nearest is None:
        parts.append("No active hazard in the search area")
    else:
        h, d = nearest
        shape = "footprint" if h.has_footprint else "reported centre (no footprint published)"
        parts.append(f"Inside the {h.title} footprint" if d == 0
                     else f"{h.title} is {d / 1000:.1f} km from the {target} (measured to its {shape})")
    if route_part:
        if route_part["exposed_m"] > 0:
            titles = {f"{h.source_id}:{h.external_id}": h.title for h in ctx.hazards}
            named = ", ".join(f"{titles.get(k, k)} ({v / 1000:.1f} km)" for k, v in
                              sorted(route_part["per_hazard_m"].items(), key=lambda kv: -kv[1])[:3])
            parts.append(f"{route_part['exposed_m'] / 1000:.1f} km of the {route_part['total_m'] / 1000:.1f} km route "
                         f"({share:.0%}, about {route_part['exposed_minutes']:.0f} min) passes through: {named}")
        else:
            parts.append(f"The {route_part['total_m'] / 1000:.1f} km route does not cross any active hazard footprint")

    notes = []
    point_only = [h for h in active if not h.has_footprint]
    if point_only:
        notes.append(f"{len(point_only)} active hazard(s) have no published footprint — distance only, no extent")
    if route_part and ctx.route.precision_note:
        notes.append(ctx.route.precision_note)
    sources = list(ctx.hazard_sources_ok)
    if route_part:
        sources.append(ctx.route.source if ctx.route.source == "osrm" else "straight-line")
    inputs = {"assessment_radius_m": R, "hazards_considered": len(active), "proximity": round(proximity, 4),
              "nearest_distance_m": None if nearest is None else round(nearest[1]),
              "nearest_hazard": None if nearest is None else f"{nearest[0].source_id}:{nearest[0].external_id}",
              "measured_to": None if nearest is None else ("footprint" if nearest[0].has_footprint else "centroid")}
    if route_part:
        inputs.update({"route_length_m": round(route_part["total_m"]), "exposed_m": round(route_part["exposed_m"]),
                       "exposed_fraction": round(share, 4), "exposed_minutes": round(route_part["exposed_minutes"], 1),
                       "per_hazard_m": {k: round(v) for k, v in route_part["per_hazard_m"].items()},
                       "route_source": ctx.route.source})
    return FactorResult(
        key=KEY, label=FACTOR_LABELS[KEY], status="derived" if route_part else "measured", value=round(value, 4),
        raw_value=None if nearest is None else round(nearest[1]), unit="m to nearest active hazard",
        inputs=inputs, methodology=METHOD, explanation="; ".join(parts),
        observed_at=nearest[0].observed_at if nearest else None, computed_at=now,
        data_quality=DataQuality(sources=sources, geographic_precision_m=(
            None if nearest is None or nearest[0].has_footprint else 10_000), notes=notes),
    )
