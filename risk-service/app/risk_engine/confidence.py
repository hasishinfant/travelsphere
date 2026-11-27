"""Confidence in the assessment: how much the evidence behind the eight factors can be trusted (higher = better).

It is NOT a risk factor and never enters the risk category, the composite index or the destination score: good data
must not make a place look safer, and missing data must not make it look more dangerous (missing data is reported
as missing). It is shown next to every result.

Five components, each 0–1, averaged with equal weight over those that could be evaluated (an unweighted baseline):
  credibility   mean source-tier score of the sources actually used (official 1.0 > scientific model 0.85 >
                community 0.65 > configured 0.4 — ordinal convention, app/processing/data_quality.py)
  freshness     worst freshness of the time-sensitive sources (1 within the source's maximum age, linear to 0 at 2×)
  completeness  share of applicable factors that have data
  precision     weather grid distance (1 at the point, 0 at ≥ 25 km); share of nearby hazards with real footprints;
                routed (OSRM) vs straight-line route; DEM terrain available; routed vs estimated drive time to care
  agreement     share of cross-checks that agree (USGS vs GDACS earthquake class; weather code vs precipitation)
Score = 100 × mean. Level (scoring config): ≥ 80 high, ≥ 60 medium, else low, with two caps:
  * a primary hazard factor (weather severity or active hazards) is unavailable → at most low
  * any input is stale → at most medium
"""
from __future__ import annotations

from statistics import mean

from app.processing.data_quality import SOURCES, TIER_SCORE, freshness_score
from app.risk_engine.context import AssessmentContext
from app.schemas.factors import FACTOR_LABELS, FactorResult

METHOD = ("100 × unweighted mean of credibility, freshness, completeness, precision and source agreement; "
          "level high ≥ 80, medium ≥ 60, else low; capped at low without a primary hazard factor, at medium when stale.")
PRIMARY = ("weather_severity", "hazard_severity")
LEVELS = ("low", "medium", "high")
DEFAULT_LEVELS = {"high": 0.8, "medium": 0.6}


def compute(ctx: AssessmentContext, factors: list[FactorResult], levels: dict | None = None) -> dict:
    levels = levels or DEFAULT_LEVELS
    by = {f.key: f for f in factors}
    applicable = [f for f in factors if f.status != "not_applicable"]
    available = [f for f in applicable if f.available]
    missing = [f.key for f in applicable if not f.available]

    used = sorted({s for f in available for s in f.data_quality.sources if s in SOURCES})
    credibility = mean(TIER_SCORE[SOURCES[s].tier] for s in used) if used else None

    fresh_scores = []
    if ctx.weather:
        fresh_scores.append(freshness_score("open-meteo-forecast", ctx.weather.observed_at, ctx.now)[0])
    if ctx.hazards is not None:
        last = max((h.retrieved_at for h in ctx.hazards), default=ctx.now)
        fresh_scores += [freshness_score(s, last, ctx.now)[0] for s in ctx.hazard_sources_ok]
    fresh_scores = [x for x in fresh_scores if x is not None]
    freshness = min(fresh_scores) if fresh_scores else None

    completeness = len(available) / len(applicable) if applicable else None

    precision_parts = []
    w = by.get("weather_severity")
    if w and w.available and w.data_quality.geographic_precision_m is not None:
        precision_parts.append(max(0.0, 1 - w.data_quality.geographic_precision_m / 25_000))
    near = [h for h in (ctx.hazards or []) if h.active_during(ctx.window_start, ctx.window_end)]
    if near:
        precision_parts.append(sum(h.has_footprint for h in near) / len(near))
    if ctx.mode == "journey" and ctx.route is not None:
        precision_parts.append(1.0 if ctx.route.source == "osrm" else 0.5)
    t = by.get("terrain")
    if t and t.available:
        precision_parts.append(1.0 if t.status == "measured" else 0.5)
    a = by.get("emergency_access")
    if a and a.available:
        precision_parts.append(1.0 if a.inputs.get("precision") == "osrm-routed" else 0.5)
    precision = mean(precision_parts) if precision_parts else None

    checks = [c["agree"] for c in ctx.agreement_checks]
    wi = w.inputs.get("internal_agreement") if w and w.available else None
    if wi is not None:
        checks.append(wi >= 0.9)
    agreement = sum(checks) / len(checks) if checks else None

    comps = {"credibility": credibility, "freshness": freshness, "completeness": completeness,
             "precision": precision, "agreement": agreement}
    scored = {k: round(v, 3) for k, v in comps.items() if v is not None}
    value = round(mean(scored.values()), 4) if scored else 0.0
    level = "high" if value >= levels["high"] else "medium" if value >= levels["medium"] else "low"

    caps = []
    stale = [f.label for f in available if f.data_quality.is_stale]
    primary_missing = [FACTOR_LABELS[k] for k in PRIMARY if k in missing]
    if primary_missing:
        caps.append(f"capped at low: {', '.join(primary_missing)} unavailable")
        level = "low"
    elif stale and LEVELS.index(level) > LEVELS.index("medium"):
        caps.append("capped at medium: stale input")
        level = "medium"

    weakest = min(scored, key=scored.get) if scored else None
    parts = [f"{len(available)} of {len(applicable)} applicable factors have data"]
    if missing:
        parts.append("missing: " + ", ".join(FACTOR_LABELS[k] for k in missing))
    if stale:
        parts.append("stale: " + ", ".join(stale))
    if weakest:
        parts.append(f"weakest component: {weakest} ({scored[weakest]:.2f})")
    parts += caps
    return {"score": round(value * 100), "value": value, "level": level, "components": scored,
            "not_evaluated": [k for k, v in comps.items() if v is None], "weakest": weakest,
            "sources_used": used, "missing_factors": missing, "stale_factors": stale, "caps": caps,
            "agreement_checks": ctx.agreement_checks, "explanation": "; ".join(parts), "method": METHOD}
