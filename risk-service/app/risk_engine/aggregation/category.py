"""Risk category from the eight factors (scoring-v2). One rule set for destination overviews and journeys.

The category answers "how dangerous are current conditions for this plan?". It is decided by explicit rules, never by
averaging, so a violent storm cannot be diluted by calm factors and every level can be traced to the rule that fired.

  1. Hazard (base)       class = max(weather severity, active-hazard severity where the traveller is).
                         Hazard intensity drives impact (Biardeau et al. 2026). No hazard data → no category.
  2. Amplifiers          raise the hazard class by ONE step in total, however many fire (no compounding):
       a. exposed activity   trekking/water with weather ≥ moderate
       b. hazardous terrain  terrain ≥ moderate, hazard ≥ minor, and an open-air activity on that ground
       c. weak response      hazard ≥ moderate with poor access to care (≥ moderate) or a remote place (≥ moderate)
  3. Context floor       activity-and-timing ≥ moderate (mostly dark during an open-air activity) gives at least
                         MODERATE only on remote or steep ground (remoteness ≥ minor or terrain ≥ moderate) —
                         darkness in a lit city is not a hazard; elsewhere it is reported, not escalated.
  4. Hazard history      reported (seasonal outlook, return periods), never escalates: it is susceptibility, not
                         a current condition.
  5. Critical override   a verified red alert (GDACS / USGS PAGER) affecting the location or route → CRITICAL.
  Class → category: none/minor → LOW, moderate → MODERATE, severe/extreme → HIGH. Amplifiers never reach CRITICAL.
"""
from __future__ import annotations

from app.risk_engine.context import AssessmentContext
from app.schemas.factors import FactorResult, class_rank, max_class, shift_class

CATEGORY_ORDER = ["LOW", "MODERATE", "HIGH", "CRITICAL"]


def _cls(f: FactorResult | None) -> str | None:
    return f.severity_class if f is not None and f.available else None


def decide(ctx: AssessmentContext, factors: list[FactorResult], rules: dict) -> dict:
    by = {f.key: f for f in factors}
    to_cat = rules["class_to_category"]
    weather, hazard = _cls(by.get("weather_severity")), _cls(by.get("hazard_severity"))
    terrain, timing = _cls(by.get("terrain")), _cls(by.get("activity_timing"))
    access, remote = _cls(by.get("emergency_access")), _cls(by.get("remoteness"))
    rationale: list[str] = []

    base = max_class(weather, hazard)
    if base is None:
        return {"category": None, "base_class": None, "amplifiers": [], "floor": None,
                "rationale": ["Neither weather nor active-hazard data is available — no risk category is given"]}
    drivers = [f"{by[k].label}: {c}" for k, c in (("weather_severity", weather), ("hazard_severity", hazard))
               if c and c != "none"]
    rationale += drivers

    amps = []
    a = rules["amplifiers"]
    if ctx.activity in a["exposed_activities"] and class_rank(weather) >= class_rank(a["exposed_activity_min_weather"]):
        amps.append(f"{ctx.activity} is an exposed outdoor activity in {weather} weather")
    if (terrain and class_rank(terrain) >= class_rank(a["terrain_min_class"]) and class_rank(base) >= class_rank("minor")
            and ctx.activity in a["open_air_activities"]):
        amps.append(f"{terrain} terrain ({by['terrain'].explanation.split(':')[0].lower()}) during {ctx.activity}")
    if class_rank(base) >= class_rank(a["response_min_hazard"]):
        weak = []
        if access and class_rank(access) >= class_rank("moderate"):
            weak.append("emergency care is more than 2 hours away")
        if remote and class_rank(remote) >= class_rank("moderate"):
            weak.append("the place is remote")
        if weak:
            amps.append(" and ".join(weak))
    cls = shift_class(base, 1) if amps and base != "none" else base
    if cls != base:
        rationale.append(f"Raised {base} → {cls}: " + "; ".join(amps))

    category = to_cat[cls]
    floor = None
    if timing and class_rank(timing) >= class_rank("moderate"):
        hard_ground = (remote and class_rank(remote) >= class_rank("minor")) or \
                      (terrain and class_rank(terrain) >= class_rank("moderate"))
        if hard_ground:
            floor = "MODERATE"
            if CATEGORY_ORDER.index(category) < CATEGORY_ORDER.index(floor):
                category = floor
                rationale.append("After dark during an open-air activity on remote or steep ground")
    return {"category": category, "base_class": base, "class": cls, "amplifiers": amps, "floor": floor,
            "rationale": rationale}
