"""Factor 2 — Hazard severity (ACTIVE hazards only).

Inputs: active hazard events from GDACS (floods, cyclones, earthquakes, wildfires, volcanoes, droughts) and USGS
(earthquakes, merged with GDACS duplicates), plus admin-configured risk zones (unverified).
A hazard affects the subject when its footprint intersects the destination point / journey route, or — for point-only
hazards without a footprint — lies within the destination's assessment radius, and it is active during the period.

Severity is the hazard's own official scale (GDACS alert level, USGS PAGER / magnitude class) or, inside cyclone wind
buffers, the local wind class. Historical susceptibility is NOT included here (see historical_incident_risk).
"""
from __future__ import annotations

from app.processing.data_quality import age_minutes, freshness_score
from app.risk_engine.context import AssessmentContext, affecting_hazards
from app.schemas.factors import FACTOR_LABELS, SEVERITY_ORDER, SEVERITY_VALUE, DataQuality, FactorResult, unavailable

KEY = "hazard_severity"
METHOD = ("Highest official severity (GDACS alert / USGS PAGER or magnitude class / cyclone wind buffer) among active "
          "hazards whose footprint touches the subject, or point hazards within the assessment radius.")


def describe(h, d: float, cls: str) -> str:
    where = "at this location" if d == 0 else f"{d / 1000:.0f} km away"
    level = f"GDACS {h.alert_level}" if h.source_id == "gdacs" else (h.severity_text or h.source_id)
    return f"{h.title} ({level}; local severity {cls}) {where}"


def compute(ctx: AssessmentContext) -> FactorResult:
    now = ctx.now
    if ctx.hazards is None:
        return unavailable(KEY, METHOD, "Hazard feeds unavailable (GDACS and USGS did not respond) — hazards cannot be ruled out", now,
                           DataQuality(sources=[], notes=[f"failed: {', '.join(ctx.hazard_sources_failed)}"]))
    hits = affecting_hazards(ctx)
    hits.sort(key=lambda x: (SEVERITY_ORDER.index(x[2]), -x[1]), reverse=True)
    top = hits[0][2] if hits else "none"

    observed = max((h.observed_at for h, _, _ in hits), default=None)
    retrieved = max((h.retrieved_at for h in ctx.hazards), default=None)
    fresh = [freshness_score(s, retrieved, now) for s in ctx.hazard_sources_ok]
    stale = any(st for _, st in fresh)
    notes = []
    if ctx.hazard_sources_failed:
        notes.append(f"Unavailable: {', '.join(ctx.hazard_sources_failed)} — hazards from these sources may be missing")
    unverified = [h for h, _, _ in hits if not h.verified]
    if unverified:
        notes.append(f"{len(unverified)} unverified hazard record(s) (configured zones / unreviewed events)")

    if hits:
        explanation = "; ".join(describe(h, d, c) for h, d, c in hits[:3])
    else:
        explanation = "No active hazard affects this " + ("route" if ctx.mode == "journey" and ctx.route else "location") \
                      + " during the assessed period"
    return FactorResult(
        key=KEY, label=FACTOR_LABELS[KEY], status="measured", value=SEVERITY_VALUE[top], severity_class=top, unit="class",
        inputs={"affecting": [{"id": h.db_id or f"{h.source_id}:{h.external_id}", "source": h.source_id,
                               "type": h.hazard_type, "title": h.title, "alert_level": h.alert_level,
                               "event_class": h.severity_class, "local_class": c, "distance_m": round(d),
                               "verified": h.verified, "footprint": h.footprint_note or "centroid only",
                               "valid_from": h.valid_from.isoformat(),
                               "valid_to": h.valid_to.isoformat() if h.valid_to else None, "url": h.url}
                              for h, d, c in hits],
                "active_hazards_in_search_area": len(ctx.hazards),
                "sources_ok": ctx.hazard_sources_ok, "sources_failed": ctx.hazard_sources_failed},
        methodology=METHOD, explanation=explanation, observed_at=observed, computed_at=now,
        data_quality=DataQuality(sources=ctx.hazard_sources_ok, observed_at=observed, retrieved_at=retrieved,
                                 age_minutes=age_minutes(retrieved, now), is_stale=stale,
                                 missing_fields=[f"source:{s}" for s in ctx.hazard_sources_failed], notes=notes),
    )
