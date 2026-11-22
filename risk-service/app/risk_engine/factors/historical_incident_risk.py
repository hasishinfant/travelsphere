"""Factor 6 — Historical incident risk (background SUSCEPTIBILITY, distinct from active hazards).

Inputs (historical window, default 10 years, within the historical search radius, default 150 km):
  * GDACS Orange/Red events (floods, cyclones, wildfires, volcanoes, droughts) — official impact-graded record
  * USGS earthquakes M ≥ 6.0 — USGS "strong" class (GDACS earthquakes are excluded to avoid double counting the same quakes)
  * TravelSphere incident reports that responders marked VERIFIED
Processing (Pandas): de-duplicate by source+id, drop invalid coordinates/dates, keep events inside the window and
radius, classify by hazard type, count per type.
Rate: λ = significant events per year. Under a Poisson assumption P(≥1 event in t years) = 1 − exp(−λt): reported
per year (destination) and for the trip length (journey). This is a frequency of significant HAZARD EVENTS in the
area — not the probability that a traveller has an accident. Incident reports cannot be normalised per visitor
because visitor-exposure denominators are not available; they are reported as a rate per year only.

Class by return period (1/λ): ≤ 1 yr → extreme, ≤ 5 yr → severe, ≤ 20 yr → moderate, ≤ 100 yr → minor, else none.
"""
from __future__ import annotations

import math

import pandas as pd

from app.geospatial.geometry import geodesic_m, valid_coordinate
from app.risk_engine.context import AssessmentContext
from app.schemas.factors import FACTOR_LABELS, SEVERITY_VALUE, DataQuality, FactorResult, max_class, unavailable

KEY = "historical_incident_risk"
METHOD = ("Annual rate λ of significant hazard events (GDACS Orange/Red, USGS M≥6) within the historical radius over "
          "the window; P(≥1) = 1 − exp(−λt); class by return period. Verified TravelSphere incidents as a separate rate.")


def _pct(p: float) -> str:
    return ">99%" if p > 0.99 else "<0.1%" if 0 < p < 0.001 else f"{p:.1%}" if p < 0.1 else f"{p:.0%}"


def return_period_class(rate_per_year: float) -> str:
    if rate_per_year <= 0:
        return "none"
    rp = 1 / rate_per_year
    return "extreme" if rp <= 1 else "severe" if rp <= 5 else "moderate" if rp <= 20 else "minor" if rp <= 100 else "none"


def events_frame(ctx: AssessmentContext) -> pd.DataFrame:
    h = ctx.history
    rows = [{"source": e.source_id, "id": e.external_id, "type": e.hazard_type, "lat": e.latitude, "lon": e.longitude,
             "start": e.valid_from, "alert": e.alert_level, "class": e.severity_class, "title": e.title}
            for e in (h.events or [])]
    df = pd.DataFrame(rows, columns=["source", "id", "type", "lat", "lon", "start", "alert", "class", "title"])
    if df.empty:
        return df
    df = df.drop_duplicates(subset=["source", "id"])
    df = df[[valid_coordinate(a, b) for a, b in zip(df["lat"], df["lon"])]]
    df = df[(df["start"] >= h.window_start) & (df["start"] <= h.window_end)]
    # GDACS also lists earthquakes; USGS is the authoritative catalogue for them
    df = df[~((df["source"] == "gdacs") & (df["type"] == "earthquake"))]
    df = df[(df["source"] != "gdacs") | (df["alert"].isin(["orange", "red"]))]
    df["distance_m"] = [geodesic_m(ctx.location.y, ctx.location.x, a, b) for a, b in zip(df["lat"], df["lon"])]
    return df[df["distance_m"] <= h.radius_m]


def compute(ctx: AssessmentContext) -> FactorResult:
    now = ctx.now
    h = ctx.history
    if h is None or h.events is None:
        return unavailable(KEY, METHOD, "Historical hazard records unavailable (GDACS/USGS history did not respond)", now)
    years = max((h.window_end - h.window_start).days / 365.25, 1e-9)
    df = events_frame(ctx)
    by_type = df.groupby("type").size().to_dict() if not df.empty else {}
    lam = len(df) / years
    p_year = 1 - math.exp(-lam)
    trip_days = max(1.0, (ctx.window_end - ctx.window_start).total_seconds() / 86400) if ctx.mode == "journey" else None
    p_trip = 1 - math.exp(-lam * trip_days / 365.25) if trip_days else None

    inc_rate = (h.verified_incidents / years) if h.verified_incidents is not None else None
    cls = max_class(return_period_class(lam), return_period_class(inc_rate) if inc_rate else "none")

    if by_type:
        parts = ", ".join(f"{n} {t}{'s' if n > 1 else ''}" for t, n in sorted(by_type.items(), key=lambda kv: -kv[1]))
        text = (f"{len(df)} significant event{'s' if len(df) != 1 else ''} within {h.radius_m / 1000:.0f} km since {h.window_start:%Y} ({parts}) — "
                f"about {lam:.2f}/year, i.e. a {_pct(p_year)} chance of at least one in a year")
        if p_trip is not None:
            text += f" and {_pct(p_trip)} during a {trip_days:.0f}-day trip"
    else:
        text = f"No significant hazard events recorded within {h.radius_m / 1000:.0f} km since {h.window_start:%Y}"
    if h.verified_incidents:
        text += f"; {h.verified_incidents} verified traveller incident report(s) in the area"
    notes = ["Event frequency, not accident probability", "Incident reports not normalised: visitor numbers unavailable"]
    if h.sources_failed:
        notes.append(f"Missing history from: {', '.join(h.sources_failed)} — rate may be underestimated")
    largest = df.sort_values("class", key=lambda s: s.map({"minor": 1, "moderate": 2, "severe": 3, "extreme": 4}),
                             ascending=False).head(3) if not df.empty else df
    return FactorResult(
        key=KEY, label=FACTOR_LABELS[KEY], status="measured", value=SEVERITY_VALUE[cls], severity_class=cls,
        raw_value=round(lam, 4), unit="events/year",
        inputs={"window_start": h.window_start.date().isoformat(), "window_end": h.window_end.date().isoformat(),
                "radius_m": h.radius_m, "events_total": int(len(df)), "events_by_type": {k: int(v) for k, v in by_type.items()},
                "annual_rate": round(lam, 4), "p_at_least_one_per_year": round(p_year, 4),
                "p_at_least_one_during_trip": None if p_trip is None else round(p_trip, 5),
                "return_period_years": None if lam == 0 else round(1 / lam, 1),
                "verified_incidents": h.verified_incidents,
                "examples": [{"title": r.title, "date": r.start.date().isoformat(), "distance_km": round(r.distance_m / 1000)}
                             for r in largest.itertuples()]},
        methodology=METHOD, explanation=text, computed_at=now,
        data_quality=DataQuality(sources=h.sources_ok, missing_fields=[f"source:{s}" for s in h.sources_failed], notes=notes),
    )
