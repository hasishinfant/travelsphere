"""Safety alert generation from assessments.

* Destination-wide alerts (user_id = null) for HIGH/CRITICAL destination assessments; they are resolved when the
  condition no longer holds.
* Journey alerts for the traveller when the journey category reaches the configured minimum.
* Deduplication: one ACTIVE alert per recipient and dedup key (category + driving hazard/weather), enforced by a
  partial unique index — re-assessing the same condition does not create another alert.
* Expiry: hazard valid_to, journey end, or a fixed TTL for weather-driven destination alerts.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from app.database import repository as repo
from app.risk_engine.aggregation.destination import CATEGORY_ORDER
from app.risk_engine.context import AssessmentContext, affecting_hazards

log = logging.getLogger("risk.alerts")


def _driver(result: dict) -> tuple[str, str | None]:
    warnings = result.get("active_warnings") or []
    if warnings:
        w = max(warnings, key=lambda w: ["none", "minor", "moderate", "severe", "extreme"].index(w["local_class"]))
        return f"hazard:{w['source']}:{w['title']}", w.get("hazard_event_id")
    drv = (result["explanation"].get("hazard_detected") or "conditions")
    return f"weather:{drv.split(' ')[1] if ' ' in drv else drv}", None


def destination_alerts(result: dict, ctx: AssessmentContext, cfg: dict, now: datetime) -> None:
    cat = result["risk_category"]
    try:
        if cat is None or CATEGORY_ORDER.index(cat) < CATEGORY_ORDER.index(cfg["alerts"]["min_level"]):
            repo.resolve_destination_alerts(result["destination_id"], [])
            return
        key, hazard_id = _driver(result)
        dedup = f"dest:{result['destination_id']}:{cat}:{key}"
        hazard_end = max((h.valid_to for h in ctx.hazards or [] if h.db_id == hazard_id and h.valid_to), default=None)
        expires = hazard_end if hazard_end and hazard_end > now else now + timedelta(hours=cfg["alerts"]["destination_ttl_hours"])
        e = result["explanation"]
        repo.create_alert({
            "user_id": None, "destination_id": result["destination_id"], "journey_id": None,
            "destination_assessment_id": result["id"], "journey_assessment_id": None, "hazard_event_id": hazard_id,
            "level": cat, "title": f"{cat.title()} risk — {result['destination']['name']}"[:160],
            "body": e["summary"][:2000], "recommended_action": e["recommended_action"], "dedup_key": dedup,
            "expires_at": expires})
        repo.resolve_destination_alerts(result["destination_id"], [dedup])
    except Exception as err:  # noqa: BLE001 — alerting must not fail the assessment
        log.warning("destination alert generation failed: %s", err)


def journey_alerts(result: dict, ctx: AssessmentContext, cfg: dict, now: datetime) -> None:
    cat = result["risk_category"]
    if cat is None or CATEGORY_ORDER.index(cat) < CATEGORY_ORDER.index(cfg["alerts"]["min_level"]):
        return
    try:
        warnings = [{"source": h.source_id, "title": h.title, "local_class": c, "hazard_event_id": h.db_id}
                    for h, _, c in affecting_hazards(ctx)] if ctx.hazards is not None else []
        key, hazard_id = _driver({**result, "active_warnings": warnings})
        e = result["explanation"]
        repo.create_alert({
            "user_id": result["user_id"], "destination_id": result["destination_id"], "journey_id": result["journey_id"],
            "destination_assessment_id": None, "journey_assessment_id": result["id"], "hazard_event_id": hazard_id,
            "level": cat, "title": f"{cat.title()} risk on your journey to {ctx.destination.name}"[:160],
            "body": e["summary"][:2000], "recommended_action": e["recommended_action"],
            "dedup_key": f"journey:{result['journey_id'] or result['id']}:{cat}:{key}",
            "expires_at": max(ctx.window_end, now + timedelta(hours=1))})
    except Exception as err:  # noqa: BLE001
        log.warning("journey alert generation failed: %s", err)
