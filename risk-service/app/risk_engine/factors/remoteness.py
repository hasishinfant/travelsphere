"""Factor 8 — Remoteness (dimension: response capacity).

Literature: distance to towns was the MOST important indicator of tourism risk on the Qinghai–Tibet Plateau
(Li et al. 2026, SHAP ranking); it stands for how far help, shelter, supplies and communications are.

Input: GeoNames `cities1000` (populated places with ≥ 1 000 inhabitants, CC BY 4.0). Measured from the worst point
(the destination, or the route point farthest from a town).
  nearest town       = nearest populated place with ≥ 5 000 inhabitants (the threshold the EU/OECD Degree of
                       Urbanisation uses for towns; GeoNames gives a point population, not the grid cluster DEGURBA
                       uses, so this is an approximation)
  nearest settlement = nearest populated place with ≥ 1 000 inhabitants (reported)
Value = min(d_town, 100 km) / 100 km (linear baseline).
Class (scoring config, baseline — NOT calibrated): ≤ 10 km none, ≤ 25 km minor, ≤ 50 km moderate, > 50 km severe.
Remoteness amplifies an active hazard; on its own it never raises the risk category.
"""
from __future__ import annotations

from app.risk_engine.context import AssessmentContext
from app.schemas.factors import FACTOR_LABELS, DataQuality, FactorResult, unavailable

KEY = "remoteness"
METHOD = ("Geodesic distance from the worst point to the nearest populated place with ≥ 5 000 inhabitants "
          "(GeoNames); ≤ 10 km none, ≤ 25 km minor, ≤ 50 km moderate, else severe; value = min(d, 100 km)/100 km.")
TOWN_POPULATION = 5_000
BANDS_KM = ((10, "none"), (25, "minor"), (50, "moderate"))
VALUE_CAP_KM = 100


def remoteness_class(km: float) -> str:
    return next((c for limit, c in BANDS_KM if km <= limit), "severe")


def compute(ctx: AssessmentContext) -> FactorResult:
    now = ctx.now
    r = ctx.remoteness
    if not r or not r.get("town"):
        return unavailable(KEY, METHOD, (r or {}).get("error") or "Settlement data unavailable", now)
    town, settlement = r["town"], r.get("settlement")
    km = town["distance_m"] / 1000
    cls = remoteness_class(km)
    text = f"Nearest town: {town['name']} (pop. {town['population']:,}), {km:.1f} km"
    if settlement and settlement["distance_m"] < town["distance_m"] - 500:
        text += f"; nearest settlement: {settlement['name']} (pop. {settlement['population']:,}), " \
                f"{settlement['distance_m'] / 1000:.1f} km"
    if ctx.mode == "journey" and ctx.route is not None:
        text += " — measured from the route point farthest from a town"
    return FactorResult(
        key=KEY, label=FACTOR_LABELS[KEY], status="measured", value=round(min(km, VALUE_CAP_KM) / VALUE_CAP_KM, 4),
        severity_class=cls, raw_value=round(town["distance_m"]), unit="m to nearest town (≥ 5 000 people)",
        inputs={"town": town, "settlement": settlement, "worst_point": r.get("point"),
                "town_population_threshold": TOWN_POPULATION},
        methodology=METHOD, explanation=text, computed_at=now,
        data_quality=DataQuality(sources=["geonames"], notes=["Straight-line distance, not travel time"]),
    )
