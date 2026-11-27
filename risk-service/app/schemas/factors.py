"""The contract every factor module returns. One model for all eight factors keeps them comparable and auditable,
while `status`, `unit`, `raw_value` and `inputs` keep their different meanings explicit (a distance is not a
severity)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

# scoring-v2: eight RISK factors in four dimensions (hazard, exposure, journey context, response capacity).
# Confidence in the assessment (evidence quality) is NOT a factor: it is computed separately (risk_engine/confidence.py)
# so that good data can never make a place look safer and poor data can never make it look more dangerous.
FactorKey = Literal[
    "weather_severity", "hazard_severity",            # hazard
    "hazard_exposure", "terrain",                      # exposure
    "activity_timing", "historical_incident_risk",     # journey context
    "emergency_access", "remoteness",                  # response capacity
]
FACTOR_ORDER: list[str] = [
    "weather_severity", "hazard_severity", "hazard_exposure", "terrain",
    "activity_timing", "historical_incident_risk", "emergency_access", "remoteness",
]
FACTOR_LABELS: dict[str, str] = {
    "weather_severity": "Weather severity",
    "hazard_severity": "Active hazards",
    "hazard_exposure": "Hazard exposure",
    "terrain": "Terrain",
    "activity_timing": "Activity and timing",
    "historical_incident_risk": "Hazard history",
    "emergency_access": "Access to emergency care",
    "remoteness": "Remoteness",
}
FACTOR_DIMENSION: dict[str, str] = {
    "weather_severity": "hazard", "hazard_severity": "hazard",
    "hazard_exposure": "exposure", "terrain": "exposure",
    "activity_timing": "journey_context", "historical_incident_risk": "journey_context",
    "emergency_access": "response_capacity", "remoteness": "response_capacity",
}

# measured       — computed from provider observations
# derived        — computed from the traveller's journey (route, time, party)
# configured     — from editorial/admin configuration
# not_applicable — the factor does not apply to this assessment type (e.g. route exposure for a destination)
# unavailable    — the data needed is missing; NEVER treated as zero risk
FactorStatus = Literal["measured", "derived", "configured", "not_applicable", "unavailable"]
SeverityClass = Literal["none", "minor", "moderate", "severe", "extreme"]

# Ordinal 5-class scale shared by all hazard-side factors. Equal spacing is an ordinal encoding,
# not a claim that "extreme" is exactly four times "minor".
SEVERITY_ORDER: list[str] = ["none", "minor", "moderate", "severe", "extreme"]
SEVERITY_VALUE: dict[str, float] = {c: i / 4 for i, c in enumerate(SEVERITY_ORDER)}


def max_class(*classes: str | None) -> str | None:
    present = [c for c in classes if c is not None]
    return max(present, key=SEVERITY_ORDER.index) if present else None


def class_rank(c: str | None) -> int:
    return -1 if c is None else SEVERITY_ORDER.index(c)


def shift_class(c: str, steps: int) -> str:
    return SEVERITY_ORDER[max(0, min(len(SEVERITY_ORDER) - 1, SEVERITY_ORDER.index(c) + steps))]


class DataQuality(BaseModel):
    sources: list[str] = Field(default_factory=list)
    observed_at: datetime | None = None
    retrieved_at: datetime | None = None
    age_minutes: float | None = None
    max_age_minutes: int | None = None
    is_stale: bool = False
    from_cache: bool = False
    missing_fields: list[str] = Field(default_factory=list)
    geographic_precision_m: float | None = None
    notes: list[str] = Field(default_factory=list)


class FactorResult(BaseModel):
    key: FactorKey
    label: str
    status: FactorStatus
    value: float | None = Field(default=None, ge=0, le=1)
    severity_class: SeverityClass | None = None
    raw_value: float | None = None
    unit: str | None = None
    inputs: dict[str, Any] = Field(default_factory=dict)
    methodology: str
    explanation: str
    observed_at: datetime | None = None
    computed_at: datetime
    data_quality: DataQuality = Field(default_factory=DataQuality)

    @property
    def available(self) -> bool:
        return self.status in ("measured", "derived", "configured")


def unavailable(key: str, methodology: str, why: str, now: datetime, quality: DataQuality | None = None) -> FactorResult:
    return FactorResult(key=key, label=FACTOR_LABELS[key], status="unavailable", methodology=methodology,
                        explanation=why, computed_at=now, data_quality=quality or DataQuality(notes=[why]))


def not_applicable(key: str, methodology: str, why: str, now: datetime) -> FactorResult:
    return FactorResult(key=key, label=FACTOR_LABELS[key], status="not_applicable", methodology=methodology,
                        explanation=why, computed_at=now)
