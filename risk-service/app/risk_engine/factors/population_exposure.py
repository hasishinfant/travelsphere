"""Factor 7 — Population exposure.

Two different quantities, kept separate:
  * Exposed residents — population of the locality (GeoNames via Open-Meteo geocoding) when the locality lies inside
    the footprint of an affecting hazard of class ≥ moderate (or within the assessment radius of a point-only one);
    otherwise 0. Population DENSITY is not available from this source (no area), so it is reported as unavailable
    rather than guessed.
  * Exposed travellers — for a journey: the party size if the route/location is exposed, and traveller-hours of
    exposure (party size × exposed duration). This describes how many of OUR travellers are exposed, not crowding.

Class by order of magnitude of exposed residents, aligned with the 100 000 / 1 000 000 tiers GDACS uses in its
exposure-based alerting: 0 → none, < 1 000 → minor, < 100 000 → moderate, < 1 000 000 → severe, ≥ 1 000 000 → extreme.
"""
from __future__ import annotations

from app.risk_engine.context import AssessmentContext, affecting_hazards
from app.schemas.factors import FACTOR_LABELS, SEVERITY_ORDER, SEVERITY_VALUE, DataQuality, FactorResult, unavailable

KEY = "population_exposure"
METHOD = ("Locality population (GeoNames) counted as exposed when inside an affecting hazard (class ≥ moderate); "
          "class by order of magnitude (GDACS tiers). Travellers exposed and traveller-hours reported separately.")


def population_class(n: int) -> str:
    return "none" if n <= 0 else "minor" if n < 1_000 else "moderate" if n < 100_000 else "severe" if n < 1_000_000 else "extreme"


def compute(ctx: AssessmentContext, route_exposed_minutes: float | None = None) -> FactorResult:
    now = ctx.now
    if ctx.hazards is None:
        return unavailable(KEY, METHOD, "Hazard data unavailable — exposure cannot be determined", now)
    hits = [(h, d, c) for h, d, c in affecting_hazards(ctx, ctx.location)
            if SEVERITY_ORDER.index(c) >= SEVERITY_ORDER.index("moderate")]
    pop = ctx.place_info.population if ctx.place_info else None
    locality = ctx.place_info.name if ctx.place_info else ctx.destination.name

    if hits and pop is None:
        return unavailable(KEY, METHOD, f"{locality} is inside an active hazard area but its population is unknown", now,
                           DataQuality(sources=["open-meteo-geocoding"], missing_fields=["population"],
                                       notes=[ctx.place_error or "no GeoNames population"]))
    exposed_residents = pop if hits and pop else 0
    cls = population_class(exposed_residents)

    inputs: dict = {"locality": locality, "locality_population": pop, "population_density_per_km2": None,
                    "exposed_residents": exposed_residents,
                    "hazards": [h.title for h, _, _ in hits]}
    parts = []
    if hits:
        parts.append(f"{locality} (population {pop:,}) lies within {hits[0][0].title}")
    else:
        parts.append(f"No resident population exposed — {locality} is outside every active hazard area"
                     + (f" (population {pop:,})" if pop else ""))

    if ctx.mode == "journey":
        party = ctx.travellers or 1
        exposed_trip = bool(hits) or (route_exposed_minutes or 0) > 0
        hours = (route_exposed_minutes or 0) / 60
        inputs.update({"travellers": party, "travellers_exposed": party if exposed_trip else 0,
                       "traveller_hours_exposed": round(party * hours, 2)})
        if exposed_trip:
            parts.append(f"{party} traveller{'s' if party > 1 else ''} exposed"
                         + (f" for about {hours * 60:.0f} min on the route ({party * hours:.1f} traveller-hours)" if hours else ""))
        else:
            parts.append(f"none of the {party} traveller{'s' if party > 1 else ''} are exposed on the planned route")

    return FactorResult(
        key=KEY, label=FACTOR_LABELS[KEY], status="measured", value=SEVERITY_VALUE[cls], severity_class=cls,
        raw_value=float(exposed_residents), unit="people", inputs=inputs, methodology=METHOD,
        explanation="; ".join(parts), computed_at=now,
        data_quality=DataQuality(
            sources=["open-meteo-geocoding", *ctx.hazard_sources_ok] if ctx.place_info else ctx.hazard_sources_ok,
            retrieved_at=ctx.place_info.retrieved_at if ctx.place_info else None,
            geographic_precision_m=round(ctx.place_info.distance_m) if ctx.place_info else None,
            missing_fields=["population_density"] + ([] if pop else ["population"]),
            notes=["Population is the GeoNames locality total; density unavailable"]),
    )
