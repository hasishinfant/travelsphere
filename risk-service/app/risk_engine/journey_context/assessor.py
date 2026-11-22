"""Journey-context assessment, organised in four dimensions (they organise the reasoning; the eight factors remain
the measured inputs):

  Hazard                 weather severity at the times/places of travel, active hazards touching the route
  Exposure               route exposure (length, share, minutes), distance to hazard, activity, party size
  Journey context        time factor (darkness, season, lead time), historical event chance over the trip
  Response accessibility time to the nearest hospital from the least-served point

Category rules (scoring-v1 "journey"; baseline, not calibrated):
  1. hazard class = max(weather class, active-hazard class) — both already specific to this route and time
  2. outdoor activity (trekking, water) with weather ≥ moderate → weather class +1
  3. journey-context class (time factor), capped at "moderate" — darkness/season alone never make HIGH
  4. category = class_to_category(max(1, 3)); historical susceptibility is reported, not used for the category
  5. poor access to care with hazard ≥ moderate → category +1 (never to CRITICAL)
  6. verified red alert affecting the route/location → CRITICAL (critical override)
Because route, time, activity, party and location differ per traveller, one destination yields different journey
assessments.
"""
from __future__ import annotations

from app.risk_engine.aggregation.destination import CATEGORY_ORDER, composite, critical_override, raise_category
from app.risk_engine.context import AssessmentContext
from app.schemas.factors import SEVERITY_ORDER, FactorResult, class_rank, max_class, shift_class


def assess_journey(ctx: AssessmentContext, factors: list[FactorResult], access: dict, cfg: dict) -> dict:
    j = cfg["journey"]
    by = {f.key: f for f in factors}
    w, hz, t = by["weather_severity"], by["hazard_severity"], by["time_factor"]
    rationale: list[str] = []

    weather_cls = w.severity_class if w.available else None
    if weather_cls and ctx.activity in j["outdoor_activities"] and class_rank(weather_cls) >= class_rank(j["outdoor_weather_escalation"]["min_class"]):
        escalated = shift_class(weather_cls, j["outdoor_weather_escalation"]["steps"])
        if escalated != weather_cls:  # already at the top of the scale → nothing to report
            rationale.append(f"{ctx.activity} is an exposed outdoor activity: weather {weather_cls} → {escalated}")
        weather_cls = escalated
    hazard_cls = max_class(weather_cls, hz.severity_class if hz.available else None)

    context_cls = t.severity_class if t.available else None
    if context_cls and class_rank(context_cls) > class_rank(j["context_cap"]):
        context_cls = j["context_cap"]

    applicable = [f for f in factors if f.key != "data_reliability" and f.status != "not_applicable"]
    missing = [f.key for f in applicable if not f.available]
    idx, coverage = composite(factors, cfg)
    override = critical_override(ctx, cfg)

    if hazard_cls is None:
        category, status = None, "INCOMPLETE"
        rationale.append("Neither weather nor hazard data is available for this journey — no category is given")
    else:
        base = max_class(hazard_cls, context_cls)
        to_cat = cfg["destination"]["class_to_category"]
        category = to_cat[base]
        if context_cls and CATEGORY_ORDER.index(to_cat[context_cls]) > CATEGORY_ORDER.index(to_cat[hazard_cls]):
            rationale.append(f"Journey timing raises the level: {t.explanation.split(': ', 1)[-1]}")
        poor = j["poor_access_escalation"]
        if access.get("class") == "poor" and class_rank(hazard_cls) >= class_rank(poor["min_hazard_class"]):
            new = raise_category(category, poor["steps"])
            if new != category:
                rationale.append(f"Limited access to emergency care raises {category} → {new}")
                category = new
        if override:
            category = "CRITICAL"
            rationale.insert(0, f"Critical override: verified {override['alert_level']} alert — {override['title']}")
        stale = any(f.data_quality.is_stale for f in applicable if f.available)
        status = "COMPLETE" if not missing and not stale and access.get("class") != "unknown" else "PARTIAL"

    re_ = by["route_exposure"]
    d = by["distance_to_hazard"]
    hist = by["historical_incident_risk"]
    dims = {
        "hazard": {"class": hazard_cls, "weather_class": w.severity_class, "active_hazard_class": hz.severity_class,
                   "summary": "; ".join(x for x in [w.explanation if w.available else None,
                                                    hz.explanation if hz.available else None] if x)},
        "exposure": {"route_exposed_fraction": re_.value if re_.available else None,
                     "route_exposed_m": re_.raw_value if re_.available else None,
                     "route_exposed_minutes": re_.inputs.get("exposed_minutes") if re_.available else None,
                     "distance_to_nearest_hazard_m": d.raw_value if d.available else None,
                     "activity": ctx.activity, "outdoor": ctx.activity in j["outdoor_activities"],
                     "travellers": ctx.travellers,
                     "summary": "; ".join(x for x in [re_.explanation, d.explanation] if x)},
        "journey_context": {"class": context_cls, "time_factor": t.inputs if t.available else None,
                            "historical_p_during_trip": hist.inputs.get("p_at_least_one_during_trip") if hist.available else None,
                            "summary": t.explanation},
        "response_accessibility": access,
    }
    return {"category": category, "status": status, "composite_index": idx, "coverage": coverage,
            "missing": missing, "critical_override": bool(override), "override_event": override,
            "dimensions": dims, "rationale": rationale}


def category_rank(c: str | None) -> int:
    return -1 if c is None else CATEGORY_ORDER.index(c)


__all__ = ["assess_journey", "category_rank", "SEVERITY_ORDER"]
