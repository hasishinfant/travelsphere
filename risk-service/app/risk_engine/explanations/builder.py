"""Explanations are assembled ONLY from computed factor results and the rules that fired — no free text is invented.
Each answers: what hazard, which inputs contributed, where, how it affects the journey, how recent, what to do."""
from __future__ import annotations

from datetime import datetime

from app.risk_engine.context import AssessmentContext, affecting_hazards
from app.schemas.factors import FACTOR_LABELS, SEVERITY_ORDER, FactorResult

NOT_PROBABILITY = ("The risk category and composite index are rule-based summaries of current conditions. They are not "
                   "the probability of an accident or injury.")

ACTIONS = {
    "cyclone": "Follow official cyclone warnings, avoid coasts and exposed areas, and confirm shelter before travelling.",
    "flood": "Do not enter flooded roads or riverbanks; check local flood warnings and allow alternative routes.",
    "earthquake": "Expect aftershocks: stay clear of damaged buildings and slopes, and follow local authority guidance.",
    "wildfire": "Avoid the fire area and smoke; follow evacuation orders and keep routes out open.",
    "volcano": "Respect exclusion zones around the volcano and check aviation and ash advisories.",
    "drought": "Expect water restrictions and heat stress; carry water and follow local guidance.",
    "rain": "Avoid riverside, cliff-edge and trekking routes during heavy rain; allow extra travel time.",
    "wind": "Stay away from cliff edges, coastal viewpoints and trees; secure loose items; expect transport disruption.",
    "heat": "Plan outdoor activity for early morning, drink water regularly and rest in shade.",
    "cold": "Dress in insulated layers, cover exposed skin and limit time outdoors.",
    "code": "Postpone exposed outdoor plans and stay near shelter until the storm or icy conditions pass.",
    "visibility": "Visibility is low: avoid driving unfamiliar or remote roads and keep to marked paths.",
    "darkness": "Avoid remote outdoor areas after dark and share your plans with someone.",
    "access": "Emergency care is far from parts of this route: carry a first-aid kit and a way to call for help.",
}


def _age(dt: datetime | None, now: datetime) -> str:
    if dt is None:
        return "unknown"
    m = (now - dt).total_seconds() / 60
    return "just now" if m < 1 else f"{m:.0f} min ago" if m < 90 else f"{m / 60:.1f} h ago" if m < 2880 else f"{m / 1440:.0f} days ago"


def build(ctx: AssessmentContext, factors: list[FactorResult], category: str | None, status: str,
          rationale: list[str], access: dict | None = None, safer_route: dict | None = None) -> dict:
    now = ctx.now
    by = {f.key: f for f in factors}
    hits = affecting_hazards(ctx) if ctx.hazards is not None else []
    hits.sort(key=lambda x: SEVERITY_ORDER.index(x[2]), reverse=True)
    w = by.get("weather_severity")
    w_drivers = (w.inputs.get("drivers") or []) if w and w.available else []

    hazard_detected = None
    if hits:
        h, dist, cls = hits[0]
        hazard_detected = f"{h.title} — {h.hazard_type}, local severity {cls} ({h.source_id})"
    elif w_drivers and w_drivers[0]["class"] != "none":
        hazard_detected = f"Weather: {w_drivers[0]['description']}"

    contributing = [{"factor": f.key, "label": f.label, "value": f.value, "class": f.severity_class, "explanation": f.explanation}
                    for f in sorted(factors, key=lambda f: f.value or 0, reverse=True)
                    if f.available and f.key != "data_reliability" and (f.value or 0) > 0]

    if hits:
        h, dist, _ = hits[0]
        location = (f"{ctx.destination.name}: inside the affected area of {h.title}" if dist == 0
                    else f"{ctx.destination.name}: {dist / 1000:.0f} km from {h.title}")
    else:
        location = f"{ctx.destination.name} ({ctx.location.y:.3f}, {ctx.location.x:.3f})"

    if ctx.mode == "journey":
        re_ = by.get("route_exposure")
        effect = [re_.explanation] if re_ and re_.available else []
        if access and access.get("explanation"):
            effect.append(access["explanation"])
        if safer_route and safer_route.get("available"):
            effect.append(safer_route["summary"])
        journey_effect = "; ".join(effect) or "No route-specific effect could be determined"
    else:
        journey_effect = "Destination overview — plan a journey to assess your route, timing and activity"

    observed = [f.observed_at for f in factors if f.observed_at]
    newest = max(observed) if observed else None
    oldest = min(observed) if observed else None
    info_age = (f"Weather observed {_age(w.observed_at, now)}" if w and w.observed_at else "No weather observation") + \
               (f"; oldest input {_age(oldest, now)}" if oldest and oldest != newest else "")

    actions: list[str] = []
    for h, _, _ in hits[:2]:
        if h.hazard_type in ACTIONS and ACTIONS[h.hazard_type] not in actions:
            actions.append(ACTIONS[h.hazard_type])
    for d in w_drivers[:2]:
        kind = next((k for k in ("rain", "wind", "heat", "cold", "visibility") if k in d["description"].lower()
                     or (k == "wind" and "gust" in d["description"].lower())
                     or (k == "visibility" and "fog" in d["description"].lower())), "code")
        if d["class"] in ("moderate", "severe", "extreme") and ACTIONS[kind] not in actions:
            actions.append(ACTIONS[kind])
    t = by.get("time_factor")
    if ctx.mode == "journey" and t and t.severity_class == "moderate":
        actions.append(ACTIONS["darkness"])
    if access and access.get("class") == "poor":
        actions.append(ACTIONS["access"])
    if safer_route and safer_route.get("available"):
        actions.insert(0, safer_route["summary"])
    if category is None:
        actions = ["Current conditions could not be assessed — check official weather and civil-protection services before travelling."]
    elif not actions:
        actions = ["No elevated risk from current conditions. Check again before heading out."]

    missing = [FACTOR_LABELS[f.key] for f in factors if f.status == "unavailable"]
    summary = ({None: "Not enough data to give a risk category",
                "LOW": "Low risk from current conditions", "MODERATE": "Moderate risk — take precautions",
                "HIGH": "High risk — consider changing plans", "CRITICAL": "Critical — official red alert affecting this area"}
               [category])
    if hazard_detected:
        summary += f": {hazard_detected}"
    return {
        "summary": summary,
        "hazard_detected": hazard_detected,
        "contributing_inputs": contributing,
        "location": location,
        "journey_effect": journey_effect,
        "information_age": info_age,
        "recommended_action": actions[0],
        "additional_actions": actions[1:],
        "rules_applied": rationale,
        "missing_information": missing,
        "assessment_status": status,
        "disclaimer": NOT_PROBABILITY,
    }
