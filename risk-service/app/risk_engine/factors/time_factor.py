"""Factor 5 — Time factor.

Inputs: assessed period (planned journey start/end, or now → +1 h for a destination), destination timezone,
solar elevation (NOAA equations), hazard validity periods, weather-forecast lead time, tropical-cyclone seasons.

Components:
  darkness       share of the period with the sun below −0.833° (after sunset / before sunrise)
  season         inside the official tropical-cyclone season of the basin containing the location:
                 N Atlantic Jun 1–Nov 30 (NOAA NHC), E N Pacific May 15–Nov 30 (NHC), W N Pacific May–Nov main
                 season (JMA climatology; storms occur all year), N Indian Apr–Jun & Oct–Dec (IMD),
                 SW Indian Nov 15–Apr 30 (Météo-France RSMC La Réunion), Australian region Nov 1–Apr 30 (BoM),
                 S Pacific Nov 1–Apr 30 (Fiji Met Service RSMC Nadi). Basin boxes are approximate.
  hazard timing  whether active hazards' validity periods overlap the period (open-ended = ongoing)
  lead time      hours until the period starts; beyond 16 days no weather forecast exists

Class (baseline rules, not calibrated):
  moderate — ≥ 50 % of the period in darkness during an outdoor activity (trekking, water, sightseeing)
  minor    — any darkness, or inside the cyclone season of the basin
  none     — otherwise
"""
from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.geospatial.solar import darkness_fraction
from app.risk_engine.context import AssessmentContext, affecting_hazards
from app.risk_engine.factors.historical_incident_risk import _pct, cyclone_outlook
from app.schemas.factors import FACTOR_LABELS, SEVERITY_VALUE, DataQuality, FactorResult, max_class

KEY = "time_factor"
METHOD = ("Darkness share of the period (NOAA solar elevation), tropical-cyclone season of the basin, overlap with "
          "hazard validity periods and forecast lead time; rule-based class.")
OUTDOOR = {"trekking", "water", "sightseeing", "transit"}
FORECAST_HORIZON_H = 16 * 24

# (name, lat_min, lat_max, lon_min, lon_max, [(start_month, start_day, end_month, end_day)], authority)
BASINS = [
    ("North Atlantic", 5, 50, -100, -10, [(6, 1, 11, 30)], "NOAA NHC"),
    ("Eastern North Pacific", 5, 35, -180, -100, [(5, 15, 11, 30)], "NOAA NHC"),
    ("Western North Pacific", 0, 45, 100, 180, [(5, 1, 11, 30)], "JMA climatology (main season)"),
    ("North Indian", 0, 30, 45, 100, [(4, 1, 6, 30), (10, 1, 12, 31)], "IMD"),
    ("South-West Indian", -40, 0, 30, 90, [(11, 15, 12, 31), (1, 1, 4, 30)], "Météo-France RSMC La Réunion"),
    ("Australian region", -40, 0, 90, 160, [(11, 1, 12, 31), (1, 1, 4, 30)], "Bureau of Meteorology"),
    ("South Pacific", -40, 0, 160, 180, [(11, 1, 12, 31), (1, 1, 4, 30)], "Fiji Met Service RSMC Nadi"),
    ("South Pacific", -40, 0, -180, -120, [(11, 1, 12, 31), (1, 1, 4, 30)], "Fiji Met Service RSMC Nadi"),
]


def cyclone_season(lat: float, lon: float, when: datetime) -> tuple[str, str] | None:
    md = (when.month, when.day)
    for name, la0, la1, lo0, lo1, ranges, auth in BASINS:
        if la0 <= lat <= la1 and lo0 <= lon <= lo1:
            if any((m0, d0) <= md <= (m1, d1) for m0, d0, m1, d1 in ranges):
                return name, auth
    return None


def _tz(ctx: AssessmentContext) -> ZoneInfo | None:
    for name in (ctx.destination.timezone, ctx.weather.timezone if ctx.weather else None):
        if name:
            try:
                return ZoneInfo(name)
            except ZoneInfoNotFoundError:
                continue
    return None


def compute(ctx: AssessmentContext) -> FactorResult:
    now = ctx.now
    lat, lon = ctx.location.y, ctx.location.x
    # Destination overview: the time that matters is "now" (the 24 h weather window would always be ~50 % dark)
    start, end = (ctx.window_start, ctx.window_end) if ctx.mode == "journey" else default_window(now)
    dark =darkness_fraction(lat, lon, start, end)
    season = cyclone_season(lat, lon, start)
    lead_h = max(0.0, (start - now).total_seconds() / 3600)
    hazards = affecting_hazards(ctx) if ctx.hazards is not None else []
    ongoing = [h for h, _, _ in hazards if h.valid_to is None]
    tz = _tz(ctx)
    local = (lambda t: t.astimezone(tz).strftime("%a %d %b %H:%M")) if tz else (lambda t: t.strftime("%a %d %b %H:%M UTC"))

    outdoor = ctx.activity in OUTDOOR
    cls = "none"
    reasons = []
    if dark >= 0.5 and outdoor:
        cls = "moderate"
        reasons.append(f"{dark:.0%} of the period is after dark during an outdoor activity ({ctx.activity})")
    elif dark > 0:
        cls = "minor"
        reasons.append(f"{dark:.0%} of the period is after dark")
    cyclone, _ = cyclone_outlook(ctx)
    if season:
        cls = max_class(cls, "minor")
        reason = f"Inside the {season[0]} tropical-cyclone season ({season[1]})"
        if cyclone:
            reason += (f"; here a tropical storm passed within 100 km in {_pct(cyclone['p_week'])} of weeks "
                       f"at this time of year (1980–{(cyclone.get('years') or [None, 'now'])[1]})")
        reasons.append(reason)
    if ongoing:
        reasons.append(f"{len(ongoing)} affecting hazard(s) are ongoing with no announced end")
    if lead_h > FORECAST_HORIZON_H:
        reasons.append(f"Starts in {lead_h / 24:.0f} days — beyond the weather forecast horizon; reassess closer to travel")

    period = f"{local(start)} – {local(end)}"
    text = f"{period}: " + ("; ".join(reasons) if reasons else "daylight, outside cyclone season, no time-specific concerns")
    return FactorResult(
        key=KEY, label=FACTOR_LABELS[KEY], status="derived" if ctx.mode == "journey" else "measured",
        value=SEVERITY_VALUE[cls], severity_class=cls, raw_value=round(dark, 3), unit="darkness share",
        inputs={"window_start": start.isoformat(), "window_end": end.isoformat(), "timezone": str(tz) if tz else None,
                "darkness_fraction": round(dark, 3), "cyclone_season": season[0] if season else None,
                "season_authority": season[1] if season else None,
                "cyclone_p_week": None if cyclone is None else round(cyclone["p_week"], 5), "lead_time_hours": round(lead_h, 1),
                "beyond_forecast_horizon": lead_h > FORECAST_HORIZON_H, "activity": ctx.activity,
                "ongoing_hazards": len(ongoing)},
        methodology=METHOD, explanation=text, computed_at=now,
        data_quality=DataQuality(sources=["noaa-solar-equations"],
                                 notes=[] if tz else ["Destination timezone unknown — times shown in UTC"]),
    )


def default_window(now: datetime) -> tuple[datetime, datetime]:
    return now, now + timedelta(hours=1)
