"""Service configuration from environment variables (see risk-service/.env.example)."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field, field_validator

SERVICE_ROOT = Path(__file__).resolve().parents[2]
ENGINE_VERSION = "risk-engine-1.0.0"


class Settings(BaseModel):
    env: str = Field(default="development", pattern="^(development|test|production)$")
    host: str = "127.0.0.1"
    port: int = 8001
    database_url: str | None = None
    # Shared secret the Express API sends as a bearer token. Required outside tests.
    service_token: str | None = None

    open_meteo_url: str = "https://api.open-meteo.com/v1/forecast"
    open_meteo_archive_url: str = "https://archive-api.open-meteo.com/v1/archive"
    geocoding_url: str = "https://geocoding-api.open-meteo.com/v1/search"
    gdacs_url: str = "https://www.gdacs.org/gdacsapi/api"
    usgs_feed_url: str = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary"
    usgs_fdsn_url: str = "https://earthquake.usgs.gov/fdsnws/event/1/query"
    osrm_driving_url: str = "https://router.project-osrm.org"
    osrm_foot_url: str = "https://routing.openstreetmap.de/routed-foot"
    overpass_urls: list[str] = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    ]
    user_agent: str = "TravelSphere-RiskService/1.0 (travel safety research prototype)"

    http_timeout_s: float = 20.0
    http_retries: int = 3
    scheduler_enabled: bool = False
    scoring_config: str = "scoring-v1"
    model_dir: Path = SERVICE_ROOT / "models"

    @field_validator("database_url")
    @classmethod
    def _sqlalchemy_url(cls, v: str | None) -> str | None:
        if v and v.startswith(("postgres://", "postgresql://")):
            return "postgresql+psycopg://" + v.split("://", 1)[1]
        return v


def _bool(v: str | None, default: bool = False) -> bool:
    return default if v is None else v.strip().lower() in {"1", "true", "yes", "on"}


@lru_cache
def get_settings() -> Settings:
    e = os.environ
    s = Settings(
        env=e.get("RISK_ENV", e.get("NODE_ENV", "development")),
        host=e.get("RISK_HOST", "127.0.0.1"),
        port=int(e.get("RISK_PORT", "8001")),
        database_url=e.get("DATABASE_URL"),
        service_token=e.get("RISK_SERVICE_TOKEN") or None,
        scheduler_enabled=_bool(e.get("RISK_SCHEDULER_ENABLED")),
        http_timeout_s=float(e.get("RISK_HTTP_TIMEOUT_S", "20")),
        **({"overpass_urls": [u.strip() for u in e["OVERPASS_URLS"].split(",") if u.strip()]}
           if e.get("OVERPASS_URLS") else {}),
        **({"osrm_driving_url": e["OSRM_DRIVING_URL"]} if e.get("OSRM_DRIVING_URL") else {}),
        **({"osrm_foot_url": e["OSRM_FOOT_URL"]} if e.get("OSRM_FOOT_URL") else {}),
    )
    if s.env == "production" and (not s.service_token or len(s.service_token) < 32):
        raise RuntimeError("RISK_SERVICE_TOKEN (32+ characters) is required in production")
    return s
