"""Open-Meteo forecast + geocoding adapters (keyless, CC BY 4.0).

Every numeric value is range-checked; out-of-range values become None (missing), never 0.
Times are requested as unix timestamps so everything is UTC internally; local dates use the returned UTC offset.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.config import get_settings
from app.geospatial.geometry import geodesic_m
from app.ingestion.http import FetchResult, ProviderError, get_http
from app.schemas.domain import HourlyWeather, PlaceInfo, WeatherSnapshot

SOURCE = "open-meteo-forecast"
HOURLY_VARS = "precipitation,temperature_2m,apparent_temperature,wind_gusts_10m,weather_code,visibility,is_day"
CURRENT_VARS = "precipitation,temperature_2m,apparent_temperature,wind_gusts_10m,weather_code,visibility,is_day"
DAILY_VARS = "sunrise,sunset,precipitation_sum,wind_gusts_10m_max,temperature_2m_max,temperature_2m_min"
CACHE_S = 10 * 60

RANGES = {
    "precipitation": (0, 500), "temperature_2m": (-90, 65), "apparent_temperature": (-100, 80),
    "wind_gusts_10m": (0, 120), "weather_code": (0, 99), "visibility": (0, 200_000),
}


def _num(v: Any, lo: float, hi: float) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi else None


def _ts(v: Any) -> datetime | None:
    return datetime.fromtimestamp(v, tz=timezone.utc) if isinstance(v, (int, float)) else None


def _row(src: dict, i: int | None, rate_factor: float = 1.0) -> HourlyWeather:
    def get(k: str) -> Any:
        if i is None:
            return src.get(k)
        arr = src.get(k) or []
        return arr[i] if i < len(arr) else None

    precip = _num(get("precipitation"), *RANGES["precipitation"])
    code = _num(get("weather_code"), *RANGES["weather_code"])
    is_day = get("is_day")
    return HourlyWeather(
        time=_ts(get("time")) or datetime.now(timezone.utc),
        precipitation_mm=None if precip is None else round(precip * rate_factor, 2),
        temperature_c=_num(get("temperature_2m"), *RANGES["temperature_2m"]),
        apparent_temperature_c=_num(get("apparent_temperature"), *RANGES["apparent_temperature"]),
        wind_gust_ms=_num(get("wind_gusts_10m"), *RANGES["wind_gusts_10m"]),
        weather_code=None if code is None else int(code),
        visibility_m=_num(get("visibility"), *RANGES["visibility"]),
        is_day=True if is_day == 1 else False if is_day == 0 else None,
    )


def parse_forecast(body: dict, lat: float, lon: float, fetched: FetchResult, now: datetime | None = None) -> WeatherSnapshot:
    now = now or datetime.now(timezone.utc)
    cur = body.get("current") or {}
    observed = _ts(cur.get("time"))
    if observed is None:
        raise ProviderError(SOURCE, "missing current.time")
    if observed > now + timedelta(minutes=15):
        raise ProviderError(SOURCE, "observation timestamp is in the future")
    interval = _num(cur.get("interval"), 60, 3600) or 900
    offset = int(body.get("utc_offset_seconds") or 0)

    hourly_src = body.get("hourly") or {}
    hourly = [_row(hourly_src, i) for i in range(len(hourly_src.get("time") or []))]
    daily = body.get("daily") or {}

    def local_date(ts: Any) -> str | None:
        t = _ts(ts)
        return (t + timedelta(seconds=offset)).date().isoformat() if t else None

    def daily_map(var: str, lo: float, hi: float) -> dict[str, float | None]:
        out: dict[str, float | None] = {}
        for i, ts in enumerate(daily.get("time") or []):
            d = local_date(ts)
            vals = daily.get(var) or []
            if d:
                out[d] = _num(vals[i] if i < len(vals) else None, lo, hi)
        return out

    return WeatherSnapshot(
        latitude=lat, longitude=lon,
        grid_latitude=float(body.get("latitude", lat)), grid_longitude=float(body.get("longitude", lon)),
        timezone=body.get("timezone"), utc_offset_s=offset,
        observed_at=observed, retrieved_at=fetched.retrieved_at, from_cache=fetched.from_cache,
        current=_row(cur, None, rate_factor=3600 / interval),
        hourly=hourly,
        sunrise=[t for t in map(_ts, daily.get("sunrise") or []) if t],
        sunset=[t for t in map(_ts, daily.get("sunset") or []) if t],
        daily_precip_mm=daily_map("precipitation_sum", 0, 2000),
        daily_gust_max_ms=daily_map("wind_gusts_10m_max", 0, 120),
        daily_temp_max_c=daily_map("temperature_2m_max", -90, 65),
        daily_temp_min_c=daily_map("temperature_2m_min", -90, 65),
    )


async def fetch_weather(points: list[tuple[float, float]], now: datetime | None = None) -> list[WeatherSnapshot | None]:
    """One request for up to ~50 points. Per-point parse failures return None for that point only."""
    if not points:
        return []
    params = {
        "latitude": ",".join(f"{p[0]:.4f}" for p in points),
        "longitude": ",".join(f"{p[1]:.4f}" for p in points),
        "current": CURRENT_VARS, "hourly": HOURLY_VARS, "daily": DAILY_VARS,
        "past_days": 7, "forecast_days": 16, "timezone": "auto", "wind_speed_unit": "ms", "timeformat": "unixtime",
    }
    res = await get_http().get_json(SOURCE, get_settings().open_meteo_url, params, ttl_s=CACHE_S)
    bodies = res.data if isinstance(res.data, list) else [res.data]
    out: list[WeatherSnapshot | None] = []
    for (lat, lon), body in zip(points, bodies):
        try:
            out.append(parse_forecast(body, lat, lon, res, now))
        except ProviderError:
            out.append(None)
    out += [None] * (len(points) - len(out))
    return out


async def lookup_place(name: str, lat: float, lon: float, max_distance_m: float = 50_000) -> PlaceInfo | None:
    """Population and timezone for a named locality (GeoNames via Open-Meteo), nearest match within range."""
    res = await get_http().get_json("open-meteo-geocoding", get_settings().geocoding_url,
                                    {"name": name, "count": 10, "language": "en", "format": "json"}, ttl_s=7 * 86400)
    best: PlaceInfo | None = None
    for r in (res.data or {}).get("results") or []:
        if not str(r.get("feature_code", "")).startswith("PPL"):  # populated places only (not palaces, parks …)
            continue
        try:
            d = geodesic_m(lat, lon, float(r["latitude"]), float(r["longitude"]))
        except (KeyError, TypeError, ValueError):
            continue
        if d <= max_distance_m and (best is None or d < best.distance_m):
            pop = r.get("population")
            best = PlaceInfo(name=r.get("name", name), latitude=float(r["latitude"]), longitude=float(r["longitude"]),
                             population=int(pop) if isinstance(pop, int) and pop > 0 else None,
                             feature_code=r.get("feature_code"), timezone=r.get("timezone"), distance_m=d,
                             retrieved_at=res.retrieved_at)
    return best
