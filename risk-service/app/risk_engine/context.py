"""Everything a factor may read. Built by the services layer from ingestion results; factors never fetch data."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

from shapely.geometry import Point
from shapely.geometry.base import BaseGeometry

from app.geospatial.geometry import distance_m
from app.schemas.domain import Destination, Facility, HazardEvent, PlaceInfo, Route, WeatherSnapshot
from app.schemas.factors import SEVERITY_ORDER


@dataclass
class HistoricalRecord:
    window_start: datetime
    window_end: datetime
    radius_m: float
    events: list[HazardEvent] | None          # significant historical hazard events (None = sources failed)
    sources_ok: list[str]
    sources_failed: list[str]
    verified_incidents: int | None = None      # TravelSphere verified incident reports in the window
    cyclone_climatology: Any = None            # app.ml.hazard_climatology.Climatology (None = artefact not built)
    flood_climatology: Any = None              # same, for large floods


@dataclass
class TimedWeather:
    """Weather for one point along a journey, with the time the traveller is expected there."""
    point: Point
    eta: datetime
    snapshot: WeatherSnapshot | None


@dataclass
class AssessmentContext:
    now: datetime
    mode: Literal["destination", "journey"]
    destination: Destination
    location: Point                                   # destination point or traveller's current location
    window_start: datetime                            # period being assessed (UTC)
    window_end: datetime
    weather: WeatherSnapshot | None = None
    weather_error: str | None = None
    route_weather: list[TimedWeather] = field(default_factory=list)
    hazards: list[HazardEvent] | None = None          # active hazards within the search radius; None = all feeds failed
    hazard_sources_ok: list[str] = field(default_factory=list)
    hazard_sources_failed: list[str] = field(default_factory=list)
    agreement_checks: list[dict] = field(default_factory=list)
    route: Route | None = None
    alternatives: list[Route] = field(default_factory=list)
    activity: str = "sightseeing"
    travellers: int | None = None
    place_info: PlaceInfo | None = None
    place_error: str | None = None
    history: HistoricalRecord | None = None
    facilities: list[Facility] | None = None
    facility_error: str | None = None
    facility_search_radius_m: int = 25_000
    access: dict | None = None                        # journey_context/accessibility.assess_access result
    terrain: list[dict] | None = None                 # ingestion/elevation.terrain_samples result
    terrain_error: str | None = None
    remoteness: dict | None = None                    # {"town", "settlement", "point"} or {"error"}
    advisory: dict | None = None                      # official travel advice (data.advisory_for)
    warning_note: str | None = None                   # why a destination has no official warning feed

    @property
    def subject(self) -> BaseGeometry:
        """The geometry being assessed: the route for journeys (when known), else the point."""
        return self.route.geometry if self.mode == "journey" and self.route is not None else self.location

    @property
    def radius_m(self) -> float:
        return float(self.destination.assessment_radius_m)


def local_class(h: HazardEvent, subject: BaseGeometry) -> str:
    """Severity of a hazard where the subject is: the highest graded zone touching it (e.g. cyclone wind buffer),
    else the event's own class."""
    touching = [c for c, g, _ in h.zones if g.intersects(subject)]
    return max(touching, key=SEVERITY_ORDER.index) if touching else h.severity_class


def affecting_hazards(ctx: AssessmentContext, subject: BaseGeometry | None = None) -> list[tuple[HazardEvent, float, str]]:
    """Active hazards that affect the subject during the assessment window: footprint intersects the subject, or —
    for point-only hazards without a footprint — within the destination's assessment radius.
    Returns (hazard, distance_m, local severity class)."""
    subject = subject if subject is not None else ctx.subject
    out = []
    for h in ctx.hazards or []:
        if not h.active_during(ctx.window_start, ctx.window_end):
            continue
        d = distance_m(subject, h.geometry)
        if (h.has_footprint and d == 0) or (not h.has_footprint and d <= ctx.radius_m):
            # Inside a cyclone's outer footprint but outside every wind buffer can't happen (footprint = union of
            # buffers), so local_class is always defined.
            out.append((h, d, local_class(h, subject) if h.has_footprint else h.severity_class))
    return out
