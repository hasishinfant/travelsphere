"""Population context (scoring-v2: reported, NOT a risk factor).

Removed from the eight factors because resident population measures the size of a disaster, not the danger to this
traveller — exposure must be measured where tourists are (Camatti et al. 2024). Kept as context for the explanation:
  * Exposed residents — GeoNames locality population when the locality lies inside an affecting hazard of class
    ≥ moderate; class by order of magnitude, aligned with the GDACS 100 000 / 1 000 000 exposure tiers.
  * Exposed travellers — for a journey, the party size if exposed and traveller-hours of exposure.
"""
from __future__ import annotations

from app.risk_engine.context import AssessmentContext, affecting_hazards
from app.schemas.factors import SEVERITY_ORDER



def population_class(n: int) -> str:
    return "none" if n <= 0 else "minor" if n < 1_000 else "moderate" if n < 100_000 else "severe" if n < 1_000_000 else "extreme"


def context(ctx: AssessmentContext, route_exposed_minutes: float | None = None) -> dict:
    if ctx.hazards is None:
        return {"available": False, "explanation": "Hazard data unavailable — exposure cannot be determined"}
    hits = [(h, d, c) for h, d, c in affecting_hazards(ctx, ctx.location)
            if SEVERITY_ORDER.index(c) >= SEVERITY_ORDER.index("moderate")]
    pop = ctx.place_info.population if ctx.place_info else None
    locality = ctx.place_info.name if ctx.place_info else ctx.destination.name

    if hits and pop is None:
        return {"available": False, "locality": locality,
                "explanation": f"{locality} is inside an active hazard area but its population is unknown"}
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

    return {"available": True, "class": cls, **inputs, "explanation": "; ".join(parts),
            "source": "open-meteo-geocoding" if ctx.place_info else None}
