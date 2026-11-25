"""Request models for the internal API (validated with Pydantic v2; unknown fields rejected)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Activity = Literal["sightseeing", "trekking", "water", "transit", "dining", "shopping", "indoor", "other"]


class Coordinate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0, le=100_000)

    @model_validator(mode="after")
    def _not_null_island(self) -> "Coordinate":
        if self.latitude == 0 and self.longitude == 0:
            raise ValueError("(0, 0) is not accepted as a location (usually a missing value)")
        return self


class CountryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class FacilitiesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    radius_m: Literal[2000, 5000, 10000, 25000] = 5000


class DestinationAssessmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    destination_id: str = Field(pattern=r"^[a-z0-9-]{2,40}$")
    persist: bool = True


class JourneyAssessmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: UUID
    journey_id: UUID | None = None
    destination_id: str = Field(pattern=r"^[a-z0-9-]{2,40}$")
    origin: Coordinate | None = None
    current_location: Coordinate | None = None
    waypoints: list[Coordinate] = Field(default_factory=list, max_length=20)
    travel_start: datetime
    travel_end: datetime | None = None
    activity: Activity = "sightseeing"
    activity_duration_minutes: int = Field(default=120, ge=0, le=1440)
    travellers: int = Field(default=1, ge=1, le=20)
    transport_mode: Literal["driving", "foot"] = "driving"
    persist: bool = True

    @field_validator("travel_start", "travel_end")
    @classmethod
    def _aware(cls, v: datetime | None) -> datetime | None:
        if v is not None and v.tzinfo is None:
            raise ValueError("timestamps must include a timezone offset")
        return v

    @model_validator(mode="after")
    def _window(self) -> "JourneyAssessmentRequest":
        now = datetime.now(timezone.utc)
        if self.travel_start < now - timedelta(days=1):
            raise ValueError("travel_start is in the past")
        if self.travel_start > now + timedelta(days=366):
            raise ValueError("travel_start is more than a year ahead")
        if self.travel_end is not None and self.travel_end <= self.travel_start:
            raise ValueError("travel_end must be after travel_start")
        if self.travel_end is not None and self.travel_end - self.travel_start > timedelta(days=60):
            raise ValueError("journey window longer than 60 days")
        return self
