"""Shared builders. Scenario tests construct AssessmentContext objects directly (engine logic is pure); provider
parsers are tested on real recorded responses in tests/fixtures; DB tests use a throwaway Postgres database with the
real SQL migrations applied."""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
import pytest
from shapely.geometry import LineString, Point

from app.geospatial.geometry import geodesic_circle
from app.risk_engine.context import AssessmentContext, HistoricalRecord, TimedWeather
from app.schemas.domain import Destination, Facility, HazardEvent, HourlyWeather, PlaceInfo, Route, WeatherSnapshot

FIXTURES = Path(__file__).parent / "fixtures"
REPO = Path(__file__).resolve().parents[2]
NOW = datetime(2026, 11, 22, 3, 0, tzinfo=timezone.utc)  # 12:00 in Kyoto


def fixture(name: str):
    return json.loads((FIXTURES / name).read_text())


KYOTO = Destination(id="kyoto", name="Kyoto, Japan", latitude=34.9986, longitude=135.785, country_code="JP",
                    timezone="Asia/Tokyo", assessment_radius_m=50_000)


def hour(t: datetime, **kw) -> HourlyWeather:
    base = dict(precipitation_mm=0.0, temperature_c=15.0, apparent_temperature_c=15.0, wind_gust_ms=4.0,
                weather_code=1, visibility_m=30_000.0, is_day=True)
    base.update(kw)
    return HourlyWeather(time=t, **base)


def weather(now: datetime = NOW, lat: float = KYOTO.latitude, lon: float = KYOTO.longitude, observed_age_min: int = 10,
            current: dict | None = None, hourly: dict[int, dict] | None = None, hours: int = 72) -> WeatherSnapshot:
    """hourly: {hour offset from now: overrides}"""
    hourly = hourly or {}
    start = now.replace(minute=0, second=0, microsecond=0)
    rows = [hour(start + timedelta(hours=i), **hourly.get(i, {})) for i in range(hours)]
    return WeatherSnapshot(latitude=lat, longitude=lon, grid_latitude=lat + 0.01, grid_longitude=lon, timezone="Asia/Tokyo",
                           utc_offset_s=9 * 3600, observed_at=now - timedelta(minutes=observed_age_min), retrieved_at=now,
                           from_cache=False, current=hour(now, **(current or {})), hourly=rows, sunrise=[], sunset=[])


def hazard(**kw) -> HazardEvent:
    lat, lon = kw.pop("lat", KYOTO.latitude), kw.pop("lon", KYOTO.longitude)
    radius = kw.pop("footprint_m", None)
    geom = geodesic_circle(lat, lon, radius) if radius else Point(lon, lat)
    base = dict(source_id="gdacs", external_id=kw.pop("id", "FL-1"), hazard_type="flood", title="Flood in Japan",
                severity_class="severe", latitude=lat, longitude=lon, geometry=geom,
                geometry_kind="polygon" if radius else "point", valid_from=NOW - timedelta(days=1), valid_to=None,
                is_current=True, verified=True, observed_at=NOW - timedelta(minutes=30), retrieved_at=NOW,
                alert_level="orange")
    base.update(kw)
    return HazardEvent(**base)


_EMPTY = object()


def history(events=_EMPTY, years=10, failed=None, incidents=0) -> HistoricalRecord:
    return HistoricalRecord(window_start=NOW - timedelta(days=int(365.25 * years)), window_end=NOW, radius_m=150_000,
                            events=[] if events is _EMPTY else events, sources_ok=["gdacs", "usgs-earthquakes"],
                            sources_failed=failed or [], verified_incidents=incidents)


def place(pop=1_463_723) -> PlaceInfo:
    return PlaceInfo(name="Kyoto", latitude=35.0211, longitude=135.7538, population=pop, feature_code="PPLA",
                     timezone="Asia/Tokyo", distance_m=3_700, retrieved_at=NOW)


def terrain(rise_m: float = 3.0, lat: float = KYOTO.latitude, lon: float = KYOTO.longitude) -> list[dict]:
    """DEM samples for one point: centre 50 m, every 300 m neighbour `rise_m` higher (slope = rise/300)."""
    return [{"lat": lat, "lon": lon, "centre_m": 50.0, "ring300_m": [50.0 + rise_m] * 8, "ring1000_m": [50.0] * 8}]


def remote(town_km: float = 1.5, settlement_km: float | None = None, population: int = 50_000) -> dict:
    """Default: a 50 000-person town 1.5 km away (not a built-up area for the terrain factor)."""
    town = {"name": "Town", "country": "JP", "population": population, "distance_m": town_km * 1000,
            "latitude": 35.02, "longitude": 135.75}
    s = town if settlement_km is None else {**town, "name": "Village", "population": 1_200, "distance_m": settlement_km * 1000}
    return {"town": town, "settlement": s, "point": {"lat": KYOTO.latitude, "lon": KYOTO.longitude}}


def access(minutes: float | None = 12.0, fac=_EMPTY) -> dict:
    from app.risk_engine.journey_context.accessibility import assess_access
    f = facilities() if fac is _EMPTY else fac
    return assess_access(Point(KYOTO.longitude, KYOTO.latitude), f, None if minutes is None else [minutes],
                         {"adequate": 60, "limited": 120}, 25_000)


def ctx(mode="destination", **kw) -> AssessmentContext:
    base = dict(now=NOW, mode=mode, destination=KYOTO, location=Point(KYOTO.longitude, KYOTO.latitude),
                window_start=NOW, window_end=NOW + timedelta(hours=24), weather=weather(), hazards=[],
                hazard_sources_ok=["gdacs", "usgs-earthquakes"], history=history(), place_info=place(),
                terrain=terrain(), remoteness=remote(), access=access())
    base.update(kw)
    return AssessmentContext(**base)


def route(coords=((135.70, 34.99), (135.86, 34.99)), duration_s=1800.0, source="osrm") -> Route:
    line = LineString(coords)
    from app.geospatial.geometry import length_m
    return Route(geometry=line, distance_m=length_m(line), duration_s=duration_s, profile="driving", source=source)


def facilities(n_km: float = 2.0) -> list[Facility]:
    return [Facility(osm_id="n1", kind="hospital", name="Kyoto University Hospital", latitude=KYOTO.latitude + n_km / 111,
                     longitude=KYOTO.longitude),
            Facility(osm_id="n2", kind="police", name="Police", latitude=KYOTO.latitude, longitude=KYOTO.longitude + 0.01)]


__all__ = ["NOW", "KYOTO", "ctx", "terrain", "remote", "access", "weather", "hazard", "history", "place", "route", "facilities", "fixture", "TimedWeather"]


# ------------------------------------------------------------------ database
ADMIN_URL = os.environ.get("TEST_ADMIN_DATABASE_URL", "postgresql://localhost:5432/postgres")
TEST_DB = "travelsphere_risk_test"


@pytest.fixture(scope="session")
def database_url():
    try:
        admin = psycopg.connect(ADMIN_URL, autocommit=True)
    except psycopg.OperationalError:
        pytest.skip("PostgreSQL not available")
    admin.execute(f"drop database if exists {TEST_DB} with (force)")
    admin.execute(f"create database {TEST_DB}")
    url = ADMIN_URL.rsplit("/", 1)[0] + f"/{TEST_DB}"
    with psycopg.connect(url, autocommit=True) as c:
        c.execute((REPO / "supabase/local/00_auth_shim.sql").read_text())
        for f in sorted((REPO / "supabase/migrations").glob("*.sql")):
            c.execute(f.read_text())
    yield url
    admin.execute(f"drop database if exists {TEST_DB} with (force)")
    admin.close()


@pytest.fixture
def db(database_url, monkeypatch):
    from sqlalchemy import create_engine
    from app.core import config
    from app.database import session
    monkeypatch.setenv("DATABASE_URL", database_url)
    config.get_settings.cache_clear()
    eng = create_engine("postgresql+psycopg://" + database_url.split("://", 1)[1], future=True)
    session.set_engine(eng)
    yield eng
    session.set_engine(None)
    eng.dispose()
    config.get_settings.cache_clear()


@pytest.fixture
def user_id(database_url):
    with psycopg.connect(database_url, autocommit=True) as c:
        return str(c.execute("insert into auth.users (email) values (gen_random_uuid()::text || '@t.test') returning id").fetchone()[0])
