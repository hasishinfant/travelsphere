"""Factor 1 — Weather severity.

Inputs (Open-Meteo, hourly + current): precipitation rate (mm/h), wind gusts at 10 m (m/s), apparent temperature
(°C), WMO weather code, visibility (m). Period: destination → now to +24 h; journey → each route point at its
expected time.

Hazard-specific thresholds (each maps to the shared 5-class scale; the factor is the worst driver):
  Rain rate      AMS: moderate 2.5–7.6 → minor, heavy > 7.6 → moderate; UK Met Office: very heavy ≥ 16 → severe,
                 violent ≥ 50 → extreme
  Wind gusts     Beaufort: 6 (10.8) → minor, 8 gale (17.2) → moderate, 10 storm (24.5) → severe,
                 12 hurricane force (32.7) → extreme
  Heat           US NWS heat-index categories on apparent temperature: caution 27 → minor,
                 extreme caution 32 → moderate, danger 39 → severe, extreme danger 51 → extreme
  Cold           Environment Canada wind-chill risk on apparent temperature: −10 → minor, −28 (frostbite in
                 10–30 min) → moderate, −40 (5–10 min) → severe, −48 (< 5 min) → extreme
  WMO codes      95 thunderstorm → moderate; 96/99 with hail → severe; 66/67 freezing rain → moderate;
                 75/86 heavy snow → moderate; 71/73/77/85 snow → minor
  Visibility     WMO fog < 1000 m → minor; US NWS dense fog ≤ 400 m (¼ mile) → moderate
Apparent temperature is used as the proxy for heat index / wind chill (it combines temperature, humidity and wind).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from app.geospatial.geometry import geodesic_m
from app.processing.data_quality import age_minutes, freshness_score, weather_internal_agreement
from app.risk_engine.context import AssessmentContext
from app.schemas.domain import HourlyWeather, WeatherSnapshot
from app.schemas.factors import FACTOR_LABELS, SEVERITY_ORDER, SEVERITY_VALUE, DataQuality, FactorResult, unavailable

KEY = "weather_severity"
METHOD = ("Worst hourly driver across rain rate (AMS/Met Office), gusts (Beaufort), heat (NWS heat index), "
          "cold (Env. Canada wind chill), WMO weather codes and visibility (WMO/NWS fog) over the assessed period.")

WMO_TEXT = {95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail",
            66: "Freezing rain", 67: "Heavy freezing rain", 75: "Heavy snow", 86: "Heavy snow showers",
            71: "Light snow", 73: "Snow", 77: "Snow grains", 85: "Snow showers", 45: "Fog", 48: "Freezing fog"}


def rain_class(mm_h: float) -> str:
    return "extreme" if mm_h >= 50 else "severe" if mm_h >= 16 else "moderate" if mm_h > 7.6 else "minor" if mm_h >= 2.5 else "none"


def gust_class(ms: float) -> str:
    return "extreme" if ms >= 32.7 else "severe" if ms >= 24.5 else "moderate" if ms >= 17.2 else "minor" if ms >= 10.8 else "none"


def heat_class(c: float) -> str:
    return "extreme" if c >= 51 else "severe" if c >= 39 else "moderate" if c >= 32 else "minor" if c >= 27 else "none"


def cold_class(c: float) -> str:
    return "extreme" if c <= -48 else "severe" if c <= -40 else "moderate" if c <= -28 else "minor" if c <= -10 else "none"


def code_class(code: int) -> str:
    if code in (96, 99):
        return "severe"
    if code in (95, 66, 67, 75, 86):
        return "moderate"
    if code in (71, 73, 77, 85):
        return "minor"
    return "none"


def visibility_class(m: float) -> str:
    return "moderate" if m <= 400 else "minor" if m < 1000 else "none"


def hour_drivers(h: HourlyWeather) -> list[tuple[str, str, str]]:
    """(driver kind, class, description) for one hour."""
    out: list[tuple[str, str, str]] = []
    if h.precipitation_mm is not None and (c := rain_class(h.precipitation_mm)) != "none":
        out.append(("rain", c, f"{'Violent' if c == 'extreme' else 'Very heavy' if c == 'severe' else 'Heavy' if c == 'moderate' else 'Moderate'} rain {h.precipitation_mm:g} mm/h"))
    if h.wind_gust_ms is not None and (c := gust_class(h.wind_gust_ms)) != "none":
        out.append(("wind", c, f"{ {'minor': 'Strong', 'moderate': 'Gale-force', 'severe': 'Storm-force', 'extreme': 'Hurricane-force'}[c]} gusts {h.wind_gust_ms:g} m/s"))
    at = h.apparent_temperature_c if h.apparent_temperature_c is not None else h.temperature_c
    if at is not None and (c := heat_class(at)) != "none":
        out.append(("heat", c, f"Heat stress — feels like {at:g} °C"))
    if at is not None and (c := cold_class(at)) != "none":
        out.append(("cold", c, f"Cold stress — feels like {at:g} °C"))
    if h.weather_code is not None and (c := code_class(h.weather_code)) != "none":
        out.append(("code", c, WMO_TEXT.get(h.weather_code, f"WMO code {h.weather_code}")))
    if h.visibility_m is not None and (c := visibility_class(h.visibility_m)) != "none":
        out.append(("visibility", c, f"{'Dense fog' if c == 'moderate' else 'Fog'} — visibility {h.visibility_m:.0f} m"))
    return out


def _hours(s: WeatherSnapshot, start: datetime, end: datetime, now: datetime) -> list[HourlyWeather]:
    hours = s.hours_between(start, end)
    if start <= now <= end + timedelta(hours=1):
        hours = [s.current, *hours]
    return hours


def _local(t: datetime, s: WeatherSnapshot) -> str:
    return (t + timedelta(seconds=s.utc_offset_s)).strftime("%a %H:%M") + " local"


def compute(ctx: AssessmentContext) -> FactorResult:
    now = ctx.now
    series: list[tuple[WeatherSnapshot, list[HourlyWeather], str]] = []
    if ctx.mode == "journey" and ctx.route_weather:
        n = len(ctx.route_weather)
        for i, tw in enumerate(ctx.route_weather):
            if tw.snapshot:
                part = "start" if i == 0 else "end" if i == n - 1 else "middle"
                series.append((tw.snapshot, _hours(tw.snapshot, tw.eta - timedelta(minutes=30), tw.eta + timedelta(minutes=30), now),
                               f"route {part}"))
        # conditions at the destination for the rest of the planned window
        if ctx.weather:
            series.append((ctx.weather, _hours(ctx.weather, ctx.window_start, ctx.window_end, now), "at the destination"))
    elif ctx.weather:
        series.append((ctx.weather, _hours(ctx.weather, ctx.window_start, ctx.window_end, now), "at the destination"))

    if not series:
        return unavailable(KEY, METHOD, f"Weather data unavailable ({ctx.weather_error or 'provider did not respond'})", now)
    if all(not hours for _, hours, _ in series):
        horizon = max((s.forecast_end for s, _, _ in series if s.forecast_end), default=None)
        return unavailable(KEY, METHOD,
                           "The planned time is beyond the 16-day weather forecast horizon"
                           + (f" (forecast ends {horizon:%Y-%m-%d})" if horizon else ""), now,
                           DataQuality(sources=["open-meteo-forecast"], notes=["beyond forecast horizon"]))

    worst: dict[str, tuple[str, str, datetime, str, WeatherSnapshot]] = {}   # kind → (class, text, time, where, snap)
    missing: set[str] = set()
    agreement: list[bool] = []
    for snap, hours, where in series:
        for h in hours:
            for field_name in ("precipitation_mm", "wind_gust_ms", "apparent_temperature_c", "weather_code", "visibility_m"):
                if getattr(h, field_name) is None:
                    missing.add(field_name)
            if (ok := weather_internal_agreement(h.weather_code, h.precipitation_mm)) is not None:
                agreement.append(ok)
            for kind, cls, text in hour_drivers(h):
                if kind not in worst or SEVERITY_ORDER.index(cls) > SEVERITY_ORDER.index(worst[kind][0]):
                    worst[kind] = (cls, text, h.time, where, snap)

    drivers = sorted(worst.values(), key=lambda d: SEVERITY_ORDER.index(d[0]), reverse=True)
    top_class = drivers[0][0] if drivers else "none"
    primary = series[0][0]
    fresh, stale = freshness_score("open-meteo-forecast", primary.observed_at, now)
    grid_m = geodesic_m(primary.latitude, primary.longitude, primary.grid_latitude, primary.grid_longitude)

    if drivers:
        explanation = "; ".join(f"{text} ({_local(t, s)}, {where})" for _, text, t, where, s in drivers[:3])
    else:
        explanation = (f"No hazardous weather expected between {_local(ctx.window_start, primary)} and "
                       f"{_local(ctx.window_end, primary)}")

    return FactorResult(
        key=KEY, label=FACTOR_LABELS[KEY], status="measured", value=SEVERITY_VALUE[top_class], severity_class=top_class,
        raw_value=None, unit="class",
        inputs={"drivers": [{"class": c, "description": t, "time": tm.isoformat(), "where": w} for c, t, tm, w, _ in drivers],
                "hours_assessed": sum(len(h) for _, h, _ in series), "points": len(series),
                "current": {"precipitation_mm_h": primary.current.precipitation_mm, "wind_gust_ms": primary.current.wind_gust_ms,
                            "temperature_c": primary.current.temperature_c,
                            "apparent_temperature_c": primary.current.apparent_temperature_c,
                            "weather_code": primary.current.weather_code, "visibility_m": primary.current.visibility_m},
                "internal_agreement": (sum(agreement) / len(agreement)) if agreement else None},
        methodology=METHOD, explanation=explanation, observed_at=primary.observed_at, computed_at=now,
        data_quality=DataQuality(sources=["open-meteo-forecast"], observed_at=primary.observed_at,
                                 retrieved_at=primary.retrieved_at, age_minutes=age_minutes(primary.observed_at, now),
                                 max_age_minutes=90, is_stale=stale, from_cache=primary.from_cache,
                                 missing_fields=sorted(missing), geographic_precision_m=round(grid_m),
                                 notes=[f"freshness {fresh:.2f}"] if fresh is not None and fresh < 1 else []),
    )
