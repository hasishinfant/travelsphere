"""Factor 8 — Data reliability (quality of the EVIDENCE, not a hazard; higher = better evidence).

It never enters the hazard composite. It determines confidence, flags incomplete assessments and is shown next to
the result.

Components (each 0–1; the factor is their mean over components that could be evaluated — an unweighted baseline):
  credibility  mean source-tier score of sources actually used (official 1.0 > scientific model 0.85 >
               community 0.65 > configured 0.4 — ordinal convention)
  freshness    worst freshness of time-sensitive sources (1 within the source's max age, linear to 0 at 2× max age)
  completeness share of applicable factors (excluding this one) that have data
  precision    weather grid distance (1 at the point, 0 at ≥ 25 km); share of nearby hazards with real footprints;
               routed (OSRM) vs straight-line route
  agreement    share of cross-checks that agree (USGS vs GDACS earthquake class; weather code vs precipitation)
"""
from __future__ import annotations

from statistics import mean

from app.processing.data_quality import SOURCES, TIER_SCORE, freshness_score
from app.risk_engine.context import AssessmentContext
from app.schemas.factors import FACTOR_LABELS, DataQuality, FactorResult

KEY = "data_reliability"
METHOD = "Unweighted mean of credibility, freshness, completeness, precision and source-agreement components."


def compute(ctx: AssessmentContext, others: list[FactorResult]) -> FactorResult:
    now = ctx.now
    applicable = [f for f in others if f.status != "not_applicable"]
    available = [f for f in applicable if f.available]
    missing = [f.key for f in applicable if not f.available]

    used = sorted({s for f in available for s in f.data_quality.sources if s in SOURCES})
    credibility = mean(TIER_SCORE[SOURCES[s].tier] for s in used) if used else None

    fresh_scores = []
    if ctx.weather:
        fresh_scores.append(freshness_score("open-meteo-forecast", ctx.weather.observed_at, now)[0])
    if ctx.hazards is not None:
        last = max((h.retrieved_at for h in ctx.hazards), default=now)
        fresh_scores += [freshness_score(s, last, now)[0] for s in ctx.hazard_sources_ok]
    fresh_scores = [x for x in fresh_scores if x is not None]
    freshness = min(fresh_scores) if fresh_scores else None

    completeness = len(available) / len(applicable) if applicable else None

    precision_parts = []
    w = next((f for f in others if f.key == "weather_severity" and f.available), None)
    if w and w.data_quality.geographic_precision_m is not None:
        precision_parts.append(max(0.0, 1 - w.data_quality.geographic_precision_m / 25_000))
    near = [h for h in (ctx.hazards or []) if h.active_during(ctx.window_start, ctx.window_end)]
    if near:
        precision_parts.append(sum(h.has_footprint for h in near) / len(near))
    if ctx.mode == "journey" and ctx.route is not None:
        precision_parts.append(1.0 if ctx.route.source == "osrm" else 0.5)
    precision = mean(precision_parts) if precision_parts else None

    checks = [c["agree"] for c in ctx.agreement_checks]
    wi = w.inputs.get("internal_agreement") if w else None
    if wi is not None:
        checks.append(wi >= 0.9)
    agreement = sum(checks) / len(checks) if checks else None

    comps = {"credibility": credibility, "freshness": freshness, "completeness": completeness,
             "precision": precision, "agreement": agreement}
    scored = {k: round(v, 3) for k, v in comps.items() if v is not None}
    value = round(mean(scored.values()), 4) if scored else 0.0
    weakest = min(scored, key=scored.get) if scored else None
    stale = [f.label for f in available if f.data_quality.is_stale]

    parts = [f"{len(available)} of {len(applicable)} applicable factors have data"]
    if missing:
        parts.append("missing: " + ", ".join(FACTOR_LABELS[k] for k in missing))
    if stale:
        parts.append("stale: " + ", ".join(stale))
    if weakest:
        parts.append(f"weakest component: {weakest} ({scored[weakest]:.2f})")
    return FactorResult(
        key=KEY, label=FACTOR_LABELS[KEY], status="derived", value=value, severity_class=None, raw_value=value,
        unit="evidence quality (0–1, higher is better)",
        inputs={"components": scored, "not_evaluated": [k for k, v in comps.items() if v is None],
                "sources_used": used, "missing_factors": missing, "stale_factors": stale,
                "agreement_checks": ctx.agreement_checks},
        methodology=METHOD, explanation="; ".join(parts), computed_at=now,
        data_quality=DataQuality(sources=used, notes=["Describes evidence quality; not part of the hazard score"]),
    )
