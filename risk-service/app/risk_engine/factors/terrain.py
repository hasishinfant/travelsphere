"""Factor 4 — Terrain (dimension: exposure). Physical vulnerability of the ground the traveller is on.

Literature: relief of the land was the third most important indicator of tourism risk on the Qinghai–Tibet Plateau
(Li et al. 2026, XGBoost + SHAP, AUC 0.877); physical vulnerability is one of the five vulnerability dimensions of
Alvarez et al. (2022).

Inputs:
  * Copernicus DEM GLO-90 (90 m) via the Open-Meteo elevation API, sampled at each assessed point plus rings of
    8 neighbours at 300 m and at 1 000 m (destination: the point; journey: up to 5 points along the route).
  * Configured terrain features of the destination (cliffs, coastal, volcanic, waterfall, glacial river) —
    editorial, labelled "configured".
Calculation:
  slope (%)  = max over the 300 m ring of |Δh| / 300 m × 100, worst point. A 90 m DEM sampled at 300 m smooths short
               steep features (a 50 m cliff edge), so this UNDER-estimates local steepness.
  relief (m) = max − min elevation within 1 km (all 17 samples), worst point. Reported.
Class: FAO (2006) Guidelines for Soil Description slope classes, mapped ordinally (the mapping is ours):
  < 10 % (flat … sloping) → none; 10–15 % strongly sloping → minor; 15–30 % moderately steep → moderate;
  30–60 % steep → severe; > 60 % very steep → extreme.
  A configured hazardous terrain feature raises the class to at least minor (it marks a hazard the DEM cannot
  resolve, e.g. a cliff edge or a glacial river).
Built-up areas: Copernicus DEM is a SURFACE model (it includes buildings and trees). In a city it measures skyscrapers
— Times Square came out at 38 % "slope" — so in built-up areas (destination configured as urban, or a town of
≥ 100 000 people within 2 km) the DEM slope is not used and the class comes from configured features only.
Forest canopy can likewise exaggerate relief; this is not corrected.
"""
from __future__ import annotations

from app.risk_engine.context import AssessmentContext
from app.schemas.factors import FACTOR_LABELS, SEVERITY_VALUE, DataQuality, FactorResult, max_class, unavailable

KEY = "terrain"
METHOD = ("Max slope over 300 m and relief within 1 km from the Copernicus DEM GLO-90 (FAO 2006 slope classes), "
          "raised to at least minor by configured terrain hazards (cliffs, glacial rivers, …).")
RING_M = 300
BUILT_UP_POPULATION = 100_000
BUILT_UP_DISTANCE_M = 2_000
HAZARDOUS_FEATURES = {"cliffs", "glacial river", "waterfall", "volcanic", "coastal"}


def slope_class(pct: float) -> str:
    return ("none" if pct < 10 else "minor" if pct < 15 else "moderate" if pct < 30
            else "severe" if pct < 60 else "extreme")


def point_metrics(s: dict) -> dict | None:
    c = s.get("centre_m")
    ring = [v for v in s.get("ring300_m", []) if v is not None]
    if c is None or not ring:
        return None
    every = [c, *ring, *[v for v in s.get("ring1000_m", []) if v is not None]]
    return {"lat": s["lat"], "lon": s["lon"], "elevation_m": round(c),
            "slope_pct": round(max(abs(v - c) for v in ring) / RING_M * 100, 1),
            "relief_m": round(max(every) - min(every))}


def built_up(ctx: AssessmentContext) -> str | None:
    """Why the DEM must not be read as ground here, or None."""
    if ctx.destination.setting == "urban":
        return "configured as an urban destination"
    town = (ctx.remoteness or {}).get("town")
    if town and town["population"] >= BUILT_UP_POPULATION and town["distance_m"] <= BUILT_UP_DISTANCE_M:
        return f"within {BUILT_UP_DISTANCE_M / 1000:.0f} km of {town['name']} (pop. {town['population']:,})"
    return None


def compute(ctx: AssessmentContext) -> FactorResult:
    now = ctx.now
    features = sorted(f for f in (ctx.destination.terrain or [])
                      if f.replace("-", " ").replace("_", " ") in HAZARDOUS_FEATURES)
    metrics = [m for m in (point_metrics(s) for s in (ctx.terrain or [])) if m]
    urban = built_up(ctx)
    if urban:
        why = (f"Built-up area ({urban}): the elevation model includes buildings, so ground slope is not assessed"
               + (f"; configured terrain hazards: {', '.join(features)}" if features else "; no configured terrain hazards"))
        cls = "minor" if features else "none"
        return FactorResult(
            key=KEY, label=FACTOR_LABELS[KEY], status="configured", value=SEVERITY_VALUE[cls], severity_class=cls,
            raw_value=None, unit="% slope (max over 300 m)",
            inputs={"built_up": urban, "configured_features": features, "dem_points_ignored": len(metrics)},
            methodology=METHOD, explanation=why, computed_at=now,
            data_quality=DataQuality(sources=["travelsphere-config"] + (["geonames"] if "pop." in urban else []),
                                     notes=["Copernicus DEM is a surface model: in cities it measures buildings"]),
        )
    if not metrics and not features:
        why = f"Elevation data unavailable ({ctx.terrain_error})" if ctx.terrain_error else "Elevation data unavailable"
        return unavailable(KEY, METHOD, why, now)

    cls = "none"
    parts, sources = [], []
    worst = max(metrics, key=lambda m: m["slope_pct"]) if metrics else None
    if worst:
        cls = slope_class(worst["slope_pct"])
        relief = max(m["relief_m"] for m in metrics)
        where = "along the route" if ctx.mode == "journey" and len(metrics) > 1 else "at the location"
        parts.append(f"Steepest ground {where}: {worst['slope_pct']:.0f} % slope over {RING_M} m, "
                     f"{relief} m of relief within 1 km (elevation {worst['elevation_m']} m)")
        sources.append("copernicus-dem")
    if features:
        cls = max_class(cls, "minor")
        parts.append(f"Configured terrain hazards: {', '.join(features)}")
        sources.append("travelsphere-config")

    notes = ["90 m DEM sampled at 300 m: short steep features such as cliff edges are under-estimated"] if worst else \
        ["No elevation data — class from configured terrain features only"]
    return FactorResult(
        key=KEY, label=FACTOR_LABELS[KEY], status="measured" if worst else "configured", value=SEVERITY_VALUE[cls],
        severity_class=cls, raw_value=worst["slope_pct"] if worst else None, unit="% slope (max over 300 m)",
        inputs={"points": metrics, "max_slope_pct": worst["slope_pct"] if worst else None,
                "max_relief_m": max((m["relief_m"] for m in metrics), default=None),
                "configured_features": features, "slope_class_scheme": "FAO 2006 Guidelines for Soil Description"},
        methodology=METHOD, explanation="; ".join(parts), computed_at=now,
        data_quality=DataQuality(sources=sources, geographic_precision_m=90 if worst else None, notes=notes),
    )
