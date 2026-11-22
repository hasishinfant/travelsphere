"""Load (or refresh) the GDACS Orange/Red event archive into hazard_events.
Usage: python -m app.ingestion.load_history [years=10]"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone

from app.services.data import load_gdacs_history


async def main(years: float) -> None:
    now = datetime.now(timezone.utc)
    events = await load_gdacs_history(now - timedelta(days=int(365.25 * years)), now)
    print(f"stored {len(events or [])} GDACS Orange/Red events" if events is not None else "GDACS unavailable")


if __name__ == "__main__":
    asyncio.run(main(float(sys.argv[1]) if len(sys.argv) > 1 else 10))
