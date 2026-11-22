"""Normalised domain objects produced by ingestion and consumed by the factor modules."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from shapely.geometry.base import BaseGeometry


@dataclass
class Destination:
    id: str
    name: str
    latitude: float
    longitude: float
    country_code: str | None = None
    timezone: str | None = None
    assessment_radius_m: int = 50_000
    default_activity: str = "sightseeing"
    setting: str | None = None
    terrain: list[str] = field(default_factory=list)


@dataclass
class HourlyWeather:
    time: datetime  # UTC
    precipitation_mm: float | None
    temperature_c: float | None
    apparent_temperature_c: float | None
    wind_gust_ms: float | None
    weather_code: int | None
    visibility_m: float | None
    is_day: bool | None


@dataclass
class WeatherSnapshot:
    """One location's conditions from Open-Meteo, all timestamps in UTC."""
    latitude: float               # requested point
    longitude: float
    grid_latitude: float          # model grid cell actually used
    grid_longitude: float
    timezone: str | None
    utc_offset_s: int
    observed_at: datetime         # time of the "current" observation
    retrieved_at: datetime
    from_cache: bool
    current: HourlyWeather
    hourly: list[HourlyWeather]
    sunrise: list[datetime]
    sunset: list[datetime]
    daily_precip_mm: dict[str, float | None] = field(default_factory=dict)  # local date → sum (incl. past days)
    daily_gust_max_ms: dict[str, float | None] = field(default_factory=dict)
    daily_temp_max_c: dict[str, float | None] = field(default_factory=dict)
    daily_temp_min_c: dict[str, float | None] = field(default_factory=dict)
    source: str = "open-meteo-forecast"

    def hours_between(self, start: datetime, end: datetime) -> list[HourlyWeather]:
        lo = start - timedelta(minutes=59)
        return [h for h in self.hourly if lo <= h.time <= end]

    @property
    def forecast_end(self) -> datetime | None:
        return self.hourly[-1].time if self.hourly else None


@dataclass
class HazardEvent:
    source_id: str
    external_id: str
    hazard_type: str
    title: str
    severity_class: str
    latitude: float
    longitude: float
    geometry: BaseGeometry          # WGS84 (lon, lat)
    geometry_kind: str              # point | polygon | line
    valid_from: datetime
    valid_to: datetime | None
    is_current: bool
    verified: bool
    observed_at: datetime
    retrieved_at: datetime
    alert_level: str | None = None
    severity_value: float | None = None
    severity_unit: str | None = None
    severity_text: str | None = None
    country: str | None = None
    url: str | None = None
    db_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)
    # Optional graded footprints inside the overall geometry, e.g. cyclone wind buffers:
    # [(severity_class, geometry, label)] — the local severity at a point is the highest zone containing it.
    zones: list[tuple[str, BaseGeometry, str]] = field(default_factory=list)
    footprint_note: str | None = None

    def active_during(self, start: datetime, end: datetime) -> bool:
        return self.valid_from <= end and (self.valid_to is None or self.valid_to >= start)

    @property
    def has_footprint(self) -> bool:
        return self.geometry_kind == "polygon"


@dataclass
class Facility:
    osm_id: str
    kind: str
    name: str | None
    latitude: float
    longitude: float
    has_emergency: bool | None = None


@dataclass
class Route:
    geometry: Any                  # shapely LineString, WGS84
    distance_m: float
    duration_s: float
    profile: str                   # driving | foot | straight-line
    source: str                    # osrm | straight-line
    precision_note: str = ""


@dataclass
class PlaceInfo:
    name: str
    latitude: float
    longitude: float
    population: int | None
    feature_code: str | None
    timezone: str | None
    distance_m: float
    retrieved_at: datetime
