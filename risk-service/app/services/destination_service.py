"""Destination-level safety assessment: fetch → eight factors → aggregate → explain → persist → alerts."""
from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import datetime, timedelta, timezone

from shapely.geometry import Point

from app.core.config import ENGINE_VERSION, get_settings
from app.database import repository as repo
from app.ml.inference.predictor import ml_signal
from app.risk_engine.aggregation.config import load_scoring
from app.risk_engine.aggregation.destination import aggregate_destination
from app.risk_engine.context import AssessmentContext, affecting_hazards
from app.risk_engine.explanations.builder import build
from app.risk_engine.factors import (data_reliability, distance_to_hazard, hazard_severity, historical_incident_risk,
                                     population_exposure, route_exposure, time_factor, weather_severity)
from app.schemas.domain import Destination
from app.schemas.factors import FACTOR_ORDER, FactorResult
from app.services import data
from app.services.alerts import destination_alerts


def compute_factors(ctx: AssessmentContext, route_exposed_minutes: float | None = None) -> list[FactorResult]:
    fs = [weather_severity.compute(ctx), hazard_severity.compute(ctx), distance_to_hazard.compute(ctx),
          route_exposure.compute(ctx), time_factor.compute(ctx), historical_incident_risk.compute(ctx),
          population_exposure.compute(ctx, route_exposed_minutes)]
    fs.append(data_reliability.compute(ctx, fs))
    return sorted(fs, key=lambda f: FACTOR_ORDER.index(f.key))


def inputs_hash(factors: list[FactorResult]) -> str:
    basis = [(f.key, f.status, f.value, f.raw_value, f.severity_class) for f in factors]
    return hashlib.sha256(json.dumps(basis, default=str).encode()).hexdigest()[:32]


def warnings_for(ctx: AssessmentContext) -> list[dict]:
    if ctx.hazards is None:
        return []
    return [{"source": h.source_id, "hazard_type": h.hazard_type, "title": h.title, "alert_level": h.alert_level,
             "local_class": c, "distance_m": round(d), "verified": h.verified, "url": h.url,
             "valid_from": h.valid_from.isoformat(), "valid_to": h.valid_to.isoformat() if h.valid_to else None,
             "hazard_event_id": h.db_id}
            for h, d, c in affecting_hazards(ctx)]


async def build_destination_context(dest: Destination, now: datetime, cfg: dict) -> AssessmentContext:
    (snaps, w_err), hz, hist, (place, p_err) = await asyncio.gather(
        data.weather_for([(dest.latitude, dest.longitude)], now),
        data.active_hazards(dest.latitude, dest.longitude, cfg["hazard_search_radius_m"], now),
        data.history_for(dest.latitude, dest.longitude, cfg, now),
        data.place_info(dest),
    )
    hazards, ok, failed, checks = hz
    return AssessmentContext(
        now=now, mode="destination", destination=dest, location=Point(dest.longitude, dest.latitude),
        window_start=now, window_end=now + timedelta(hours=24), weather=snaps[0], weather_error=w_err,
        hazards=hazards, hazard_sources_ok=ok, hazard_sources_failed=failed, agreement_checks=checks,
        activity=dest.default_activity, place_info=place, place_error=p_err, history=hist)


async def assess_destination(dest: Destination, persist: bool = True, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    cfg = load_scoring(get_settings().scoring_config)
    ctx = await build_destination_context(dest, now, cfg)
    factors = compute_factors(ctx)
    agg = aggregate_destination(ctx, factors, cfg)
    explanation = build(ctx, factors, agg.category, agg.status, agg.drivers)
    ml = ml_signal(ctx)
    result = {
        "id": None, "destination_id": dest.id,
        "destination": {"id": dest.id, "name": dest.name, "latitude": dest.latitude, "longitude": dest.longitude},
        "risk_category": agg.category, "composite_index": agg.composite_index, "assessment_status": agg.status,
        "data_coverage": agg.coverage, "data_reliability": agg.reliability, "missing_indicators": agg.missing,
        "active_warnings": warnings_for(ctx), "critical_override": agg.critical_override,
        "override_event": agg.override_event, "explanation": explanation, "factors": [f.model_dump(mode="json") for f in factors],
        "weather": _weather_summary(ctx), "ml_signal": ml,
        "scoring_version": cfg["version"], "engine_version": ENGINE_VERSION, "inputs_hash": inputs_hash(factors),
        "assessed_at": now.isoformat(),
    }
    if persist and repo.db_available():
        if ctx.weather:
            data._safe_repo(repo.store_indicators, dest.id, "open-meteo-forecast", ctx.weather.observed_at, {
                "precipitation_rate": (ctx.weather.current.precipitation_mm, "mm/h"),
                "wind_gust": (ctx.weather.current.wind_gust_ms, "m/s"),
                "temperature": (ctx.weather.current.temperature_c, "°C"),
                "apparent_temperature": (ctx.weather.current.apparent_temperature_c, "°C"),
                "visibility": (ctx.weather.current.visibility_m, "m"),
                "weather_code": (ctx.weather.current.weather_code, "WMO 4677")})
        if ctx.place_info and ctx.place_info.population:
            data._safe_repo(repo.store_indicators, dest.id, "open-meteo-geocoding", now.replace(hour=0, minute=0, second=0, microsecond=0),
                            {"locality_population": (ctx.place_info.population, "people")})
        result["id"] = repo.save_destination_assessment(
            {**result, "assessed_at": now, "data_reliability": agg.reliability}, factors)
        destination_alerts(result, ctx, cfg, now)
    return result


def _weather_summary(ctx: AssessmentContext) -> dict | None:
    w = ctx.weather
    if not w:
        return None
    from app.risk_engine.factors.weather_severity import WMO_TEXT
    code = w.current.weather_code
    desc = WMO_TEXT.get(code) if code is not None else None
    if desc is None and code is not None:
        desc = {0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 51: "Light drizzle", 53: "Drizzle",
                55: "Dense drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain", 80: "Rain showers",
                81: "Rain showers", 82: "Violent rain showers"}.get(code, f"WMO code {code}")
    return {"summary": desc or "Unknown", "temperatureC": w.current.temperature_c,
            "rainRateMmH": w.current.precipitation_mm, "windGustMs": w.current.wind_gust_ms,
            "observed_at": w.observed_at.isoformat(), "grid_distance_m": None}
