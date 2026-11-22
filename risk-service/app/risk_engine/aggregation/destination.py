"""Destination-level aggregation.

Category (scoring-v1 "primary_hazard_max"): the worst class among the primary current-hazard factors (weather severity,
active hazard severity) mapped none/minor → LOW, moderate → MODERATE, severe/extreme → HIGH. Averaging would let a
violent storm be diluted by calm factors, so the composite index is reported separately and only used for ranking.
CRITICAL is reserved for the critical-event override (verified red alert affecting the location).

Missing data: a category is only given when at least one primary factor is available. If one primary factor is
missing the status is PARTIAL and the explanation says the missing factor could raise the category; missing data is
never scored as zero.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.risk_engine.context import AssessmentContext, affecting_hazards
from app.schemas.factors import SEVERITY_ORDER, FactorResult, max_class

CATEGORY_ORDER = ["LOW", "MODERATE", "HIGH", "CRITICAL"]


def raise_category(cat: str, steps: int = 1) -> str:
    return CATEGORY_ORDER[min(len(CATEGORY_ORDER) - 2, CATEGORY_ORDER.index(cat) + steps)]  # never reaches CRITICAL


@dataclass
class Aggregate:
    category: str | None
    composite_index: float | None
    status: str                       # COMPLETE | PARTIAL | INCOMPLETE
    coverage: float
    reliability: float | None
    missing: list[str]
    critical_override: bool
    override_event: dict | None
    drivers: list[str] = field(default_factory=list)


def composite(factors: list[FactorResult], cfg: dict) -> tuple[float | None, float]:
    """Weighted mean over AVAILABLE hazard-side factors; coverage = available weight / applicable weight."""
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


def aggregate_destination(ctx: AssessmentContext, factors: list[FactorResult], cfg: dict) -> Aggregate:
    by = {f.key: f for f in factors}
    dcfg = cfg["destination"]
    primary = [by[k] for k in dcfg["primary_factors"]]
    avail_primary = [f for f in primary if f.available and f.severity_class]
    applicable = [f for f in factors if f.key != "data_reliability" and f.status != "not_applicable"]
    missing = [f.key for f in applicable if not f.available]
    idx, coverage = composite(factors, cfg)
    reliability = by["data_reliability"].value if "data_reliability" in by else None
    stale = any(f.data_quality.is_stale for f in applicable if f.available)

    override = critical_override(ctx, cfg)
    if not avail_primary:
        return Aggregate(None, idx, "INCOMPLETE", coverage, reliability, missing, bool(override), override,
                         ["No current weather or hazard data — a risk category cannot be given"])

    top = max_class(*(f.severity_class for f in avail_primary))
    category = dcfg["class_to_category"][top]
    drivers = [f"{f.label}: {f.severity_class}" for f in sorted(avail_primary, key=lambda f: SEVERITY_ORDER.index(f.severity_class), reverse=True)
               if f.severity_class not in ("none",)]
    if override:
        category = "CRITICAL"
        drivers.insert(0, f"Critical override: verified {override['alert_level']} alert — {override['title']}")
    status = "COMPLETE" if not missing and not stale else "PARTIAL"
    return Aggregate(category, idx, status, coverage, reliability, missing, bool(override), override, drivers)
