"""Keeps live reference data ready so interactive assessments never wait on slow public servers.

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
_task: asyncio.Task | None = None


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


async def _loop() -> None:
    while True:
        try:
            await warm_facilities()
        except Exception as e:  # noqa: BLE001 — a failed warm-up must never stop the service
            log.warning("facility warm-up failed: %s", e)
        await asyncio.sleep(INTERVAL_S)


def start_warmup() -> None:
    global _task
    if _task is None or _task.done():
        _task = asyncio.get_running_loop().create_task(_loop())


def stop_warmup() -> None:
    if _task is not None and not _task.done():
        _task.cancel()


if __name__ == "__main__":  # one-off: python -m app.background.warmup
    logging.basicConfig(level=logging.INFO)
    print(asyncio.run(warm_facilities()))
