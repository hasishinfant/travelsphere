"""APScheduler jobs (enable with RISK_SCHEDULER_ENABLED=true; run in ONE service instance only).

  every 30 min  destination reassessment (refreshes weather + hazards, stores assessments, raises/resolves alerts)
  every 60 min  reassessment of journeys starting within 7 days or in progress (destination stay, owner's party)
  every 15 min  expired-alert check
  daily 03:15   purge journey locations past their retention date
  weekly        refresh of the GDACS Orange/Red archive (last 60 days) used for historical risk
Weather and hazard refresh happen as part of reassessment (HTTP cache: 10 min weather, 15 min GDACS, 5 min USGS).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, time, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.database import repository as repo
from app.schemas.api import JourneyAssessmentRequest
from app.services.destination_service import assess_destination
from app.services.journey_service import assess_journey_request

log = logging.getLogger("risk.scheduler")
_scheduler: AsyncIOScheduler | None = None


async def reassess_destinations() -> None:
    for d in repo.list_destinations():
        try:
            r = await assess_destination(d, persist=True)
            log.info("reassessed %s: %s (%s)", d.id, r["risk_category"], r["assessment_status"])
        except Exception as e:  # noqa: BLE001 — one destination failing must not stop the others
            log.warning("reassessment of %s failed: %s", d.id, e)


async def reassess_journeys() -> None:
    now = datetime.now(timezone.utc)
    for j in repo.journeys_to_reassess():
        start = max(now, datetime.combine(j["start_date"], time(9, 0), tzinfo=timezone.utc))
        try:
            dest = repo.get_destination(j["destination_id"])
            if dest is None:
                continue
            req = JourneyAssessmentRequest(user_id=j["user_id"], journey_id=j["journey_id"], destination_id=dest.id,
                                           travel_start=start, activity=j["activity"], travellers=j["travellers"])
            await assess_journey_request(req, dest, now)
        except Exception as e:  # noqa: BLE001
            log.warning("journey %s reassessment failed: %s", j["journey_id"], e)


def expire_alerts() -> None:
    n = repo.expire_alerts()
    if n:
        log.info("expired %d alerts", n)


def purge_locations() -> None:
    n = repo.purge_expired_locations()
    if n:
        log.info("purged %d journey locations past retention", n)


async def refresh_history() -> None:
    from app.services.data import load_gdacs_history
    now = datetime.now(timezone.utc)
    await load_gdacs_history(now - timedelta(days=60), now)


def start_scheduler() -> None:
    global _scheduler
    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.add_job(reassess_destinations, "interval", minutes=30, id="destinations", max_instances=1, coalesce=True,
                       next_run_time=datetime.now(timezone.utc))
    _scheduler.add_job(reassess_journeys, "interval", minutes=60, id="journeys", max_instances=1, coalesce=True)
    _scheduler.add_job(expire_alerts, "interval", minutes=15, id="expire_alerts")
    _scheduler.add_job(purge_locations, "cron", hour=3, minute=15, id="purge_locations")
    _scheduler.add_job(refresh_history, "cron", day_of_week="sun", hour=2, id="refresh_history")
    _scheduler.start()
    log.info("scheduler started")


def stop_scheduler() -> None:
    if _scheduler is not None and _scheduler.running:
        _scheduler.shutdown(wait=False)


if __name__ == "__main__":  # one-off run: python -m app.background.scheduler
    asyncio.run(reassess_destinations())
