"""Solar elevation from the NOAA "General Solar Position Calculations" equations (accuracy ~ a few minutes for
sunrise/sunset), so darkness can be determined for any date — including journeys beyond the forecast horizon —
and at polar latitudes."""
from __future__ import annotations

import math
from datetime import datetime, timedelta

SUNSET_ELEVATION = -0.833   # standard sunrise/sunset (refraction + solar radius)
CIVIL_TWILIGHT = -6.0


def solar_elevation(lat: float, lon: float, t: datetime) -> float:
    """Degrees above the horizon at UTC instant t."""
    doy = t.timetuple().tm_yday
    hour = t.hour + t.minute / 60 + t.second / 3600
    g = 2 * math.pi / 365 * (doy - 1 + (hour - 12) / 24)
    eqtime = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g)
                       - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    decl = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g)
            + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    tst = hour * 60 + eqtime + 4 * lon
    ha = math.radians(tst / 4 - 180)
    phi = math.radians(lat)
    cos_zen = math.sin(phi) * math.sin(decl) + math.cos(phi) * math.cos(decl) * math.cos(ha)
    return 90 - math.degrees(math.acos(max(-1.0, min(1.0, cos_zen))))


def darkness_fraction(lat: float, lon: float, start: datetime, end: datetime, step_min: int = 10,
                      threshold: float = SUNSET_ELEVATION) -> float:
    """Share of [start, end] with the sun below the threshold (sampled every step_min minutes)."""
    if end <= start:
        return 1.0 if solar_elevation(lat, lon, start) < threshold else 0.0
    n = max(1, int((end - start).total_seconds() // (step_min * 60)))
    samples = [start + timedelta(minutes=step_min * i) for i in range(n + 1)]
    return sum(solar_elevation(lat, lon, t) < threshold for t in samples) / len(samples)
