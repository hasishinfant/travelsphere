"""Journey assessment output, organised in the four dimensions of the eight factors (scoring-v2):

  Hazard               weather severity at the times/places of travel; active hazards touching the route
  Exposure             hazard exposure (proximity, exposed route length and minutes); terrain along the route
  Journey context      activity and timing (activity, darkness, season, lead time); hazard history over the trip
  Response capacity    access to emergency care from the least-served point; remoteness from towns

The category uses the same rules as a destination (aggregation/category.py) — what differs is the input: the
traveller's route, times, activity and party, so one destination yields different journey assessments.
"""
from __future__ import annotations

from app.risk_engine.aggregation.destination import aggregate
from app.risk_engine.context import AssessmentContext
from app.schemas.factors import SEVERITY_ORDER, FactorResult


def _dim(by: dict, *keys: str) -> dict:
    return {k: {"class": by[k].severity_class, "value": by[k].value, "status": by[k].status,
                "explanation": by[k].explanation} for k in keys if k in by}


def assess_journey(ctx: AssessmentContext, factors: list[FactorResult], access: dict, cfg: dict) -> dict:
    by = {f.key: f for f in factors}
    agg = aggregate(ctx, factors, cfg)
    status = agg.status
    if status == "COMPLETE" and access.get("class") == "unknown":
        status = "PARTIAL"
    hist = by["historical_incident_risk"]
    dims = {
        "hazard": _dim(by, "weather_severity", "hazard_severity"),
        "exposure": {**_dim(by, "hazard_exposure", "terrain"), "activity": ctx.activity, "travellers": ctx.travellers},
        "journey_context": {**_dim(by, "activity_timing", "historical_incident_risk"),
                            "historical_p_during_trip": hist.inputs.get("p_at_least_one_during_trip") if hist.available else None},
        "response_capacity": {**_dim(by, "emergency_access", "remoteness"), "access": access},
    }
    return {"category": agg.category, "status": status, "composite_index": agg.composite_index, "coverage": agg.coverage,
            "missing": agg.missing, "critical_override": agg.critical_override, "override_event": agg.override_event,
            "dimensions": dims, "rationale": agg.rationale, "decision": agg.decision}


def category_rank(c: str | None) -> int:
    from app.risk_engine.aggregation.category import CATEGORY_ORDER
    return -1 if c is None else CATEGORY_ORDER.index(c)


__all__ = ["assess_journey", "category_rank", "SEVERITY_ORDER"]
