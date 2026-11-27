"""Aggregation shared by destination and journey assessments (scoring-v2).

  category        explicit rules in aggregation/category.py (hazard base, one-step amplifiers, context floor,
                  critical override) — never an average
  composite index weighted mean of the available factor values: a ranking/trend index only, not a probability
  coverage        available weight / applicable weight
  status          COMPLETE (all applicable factors have current data), PARTIAL, or INCOMPLETE (no category)
Missing data is never scored as zero: an unavailable factor is listed in `missing` and lowers the confidence.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.risk_engine.aggregation.category import CATEGORY_ORDER, decide
from app.risk_engine.context import AssessmentContext, affecting_hazards
from app.schemas.factors import FactorResult

__all__ = ["CATEGORY_ORDER", "Aggregate", "aggregate", "composite", "critical_override"]


@dataclass
class Aggregate:
    category: str | None
    composite_index: float | None
    status: str                       # COMPLETE | PARTIAL | INCOMPLETE
    coverage: float
    missing: list[str]
    critical_override: bool
    override_event: dict | None
    rationale: list[str] = field(default_factory=list)
    decision: dict = field(default_factory=dict)


def composite(factors: list[FactorResult], cfg: dict) -> tuple[float | None, float]:
    """Weighted mean over AVAILABLE factors; coverage = available weight / applicable weight."""
    weights = cfg["composite_index"]["weights"]
    applicable = [f for f in factors if f.key in weights and f.status != "not_applicable"]
    avail = [f for f in applicable if f.available and f.value is not None]
    tot = sum(weights[f.key] for f in applicable)
    got = sum(weights[f.key] for f in avail)
    if not avail:
        return None, 0.0
    return round(sum(weights[f.key] * f.value for f in avail) / got, 4), round(got / tot, 4) if tot else 0.0


def critical_override(ctx: AssessmentContext, cfg: dict) -> dict | None:
    rule = cfg["critical_override"]
    if ctx.hazards is None:
        return None
    for h, d, _ in affecting_hazards(ctx):
        if (h.source_id in rule["sources"] and (h.alert_level or "") in rule["alert_levels"]
                and (h.verified or not rule["require_verified"])):
            return {"source": h.source_id, "id": h.db_id or h.external_id, "title": h.title, "alert_level": h.alert_level,
                    "distance_m": round(d), "url": h.url}
    return None


def aggregate(ctx: AssessmentContext, factors: list[FactorResult], cfg: dict) -> Aggregate:
    applicable = [f for f in factors if f.status != "not_applicable"]
    missing = [f.key for f in applicable if not f.available]
    idx, coverage = composite(factors, cfg)
    stale = any(f.data_quality.is_stale for f in applicable if f.available)
    d = decide(ctx, factors, cfg["category"])
    override = critical_override(ctx, cfg)
    rationale = list(d["rationale"])
    category = d["category"]
    if category is None:
        return Aggregate(None, idx, "INCOMPLETE", coverage, missing, bool(override), override, rationale, d)
    if override:
        category = "CRITICAL"
        rationale.insert(0, f"Critical override: verified {override['alert_level']} alert — {override['title']}")
    status = "COMPLETE" if not missing and not stale else "PARTIAL"
    return Aggregate(category, idx, status, coverage, missing, bool(override), override, rationale, d)
