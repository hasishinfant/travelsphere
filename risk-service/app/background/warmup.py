"""Keeps live reference data ready so interactive assessments never wait on slow public servers.

  live feeds   every 10 min: official weather warnings for every destination and the GDACS/USGS hazard lists, so
               assessments are served from fresh copies instead of waiting on slow public servers
  facilities   OpenStreetMap hospitals/clinics/police/fire around every destination (25 km), fetched with a
               generous time limit and stored in the 30-day cache that assessments read first. Public Overpass
               servers often take about a minute for a city-sized query, more than an interactive request allows.
Runs once at start-up and then every 24 h (only destinations whose cache is missing or older than 30 days are
fetched). Needs the database (the cache lives there); without it the job does nothing.
"""
from __future__ import annotations

import asyncio
import logging

from app.database import repository as repo
from app.risk_engine.aggregation.config import load_scoring
from app.core.config import get_settings

log = logging.getLogger("risk.warmup")
INTERVAL_S = 24 * 3600
FEEDS_INTERVAL_S = 10 * 60
_task: asyncio.Task | None = None
_feeds_task: asyncio.Task | None = None


async def warm_facilities() -> dict[str, str]:
    from app.services import data
    if not repo.db_available():
        return {}
    radius = load_scoring(get_settings().scoring_config)["journey"]["facility_search_radius_m"]
    out: dict[str, str] = {}
    for d in repo.list_destinations():
        found, err = await data.facilities_near(d.latitude, d.longitude, radius, background=True)
        out[d.id] = f"{len(found)} facilities" if found is not None else f"failed: {err}"
        log.info("facilities for %s: %s", d.id, out[d.id])
    return out


async def refresh_feeds() -> None:
    """Fetch warnings and hazard lists in the background (each source has its own deadline)."""
    from datetime import datetime, timezone
    from app.services import data
    now = datetime.now(timezone.utc)
    dests = repo.list_destinations() if repo.db_available() else []
    radius = load_scoring(get_settings().scoring_config)["hazard_search_radius_m"]
    jobs = [data._fetch_warnings_into_cache(d, sid) for d in dests if (sid := data.warnings.source_for(d))]
    if dests:
        jobs.append(data.active_hazards(dests[0].latitude, dests[0].longitude, radius, now))
    await asyncio.gather(*jobs, return_exceptions=True)


async def _feeds_loop() -> None:
    while True:
        try:
            await refresh_feeds()
        except Exception as e:  # noqa: BLE001
            log.warning("feed refresh failed: %s", e)
        await asyncio.sleep(FEEDS_INTERVAL_S)


async def _loop() -> None:
    while True:
        try:
            await warm_facilities()
        except Exception as e:  # noqa: BLE001 — a failed warm-up must never stop the service
            log.warning("facility warm-up failed: %s", e)
        await asyncio.sleep(INTERVAL_S)


def start_warmup() -> None:
    global _task, _feeds_task
    loop = asyncio.get_running_loop()
    if _task is None or _task.done():
        _task = loop.create_task(_loop())
    if _feeds_task is None or _feeds_task.done():
        _feeds_task = loop.create_task(_feeds_loop())


def stop_warmup() -> None:
    for t in (_task, _feeds_task):
        if t is not None and not t.done():
            t.cancel()


if __name__ == "__main__":  # one-off: python -m app.background.warmup
    logging.basicConfig(level=logging.INFO)
    print(asyncio.run(warm_facilities()))
