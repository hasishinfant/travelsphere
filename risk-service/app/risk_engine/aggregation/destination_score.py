"""Tourist Confidence Score (destination layer, 0–100, higher = a traveller can visit with more confidence).

From the team manuscript (A. K. Singh, 2026) and the Design Project-I report, Section 6.3 / Table 6.4, restricted to
its four SAFETY factors and fed with measured data. The report's other four factors (language, budget, crowd density,
preference) describe trip fit, not safety, and are not part of this score.

  factor               weight  measured by                                                   evidence
  safety index         0.20    official travel-advisory level — NOT YET INTEGRATED           Jamal Mahdi 2024; Glorioso 2026
  health & emergency   0.15    access to emergency care (factor 7)                           Mawby 2024; Health is the new safety 2026
  transport access     0.15    remoteness: distance to the nearest town (factor 8)           Li et al. 2026
  weather stability    0.10    hazard history: significant events per year (factor 6)        Biardeau 2026; Camatti 2024

Each input is a 0–1 RISK value r (the factor's value); its safety sub-score is s = 100 × (1 − r).
Score = Σ wᵢ sᵢ / Σ wᵢ over the AVAILABLE factors (weights re-normalised, never filled with defaults).
A score is given only when the available weight is ≥ 50 % of the total; it is "provisional" while any factor is
missing. Bands (report): Low 0–40, Moderate 41–65, High 66–85, Excellent 86–100.
The weights keep the report's order (safety > health = transport > weather); the exact numbers are the team's and
are to be replaced by an AHP survey (consistency ratio < 0.1). This is a slow-changing background score: current
conditions are in the risk category, not here.
"""
from __future__ import annotations

from app.schemas.factors import FactorResult

COMPONENTS = [
    ("safety_index", "Safety index", 0.20, None),
    ("health_emergency", "Health and emergency care", 0.15, "emergency_access"),
    ("transport_access", "Transport access", 0.15, "remoteness"),
    ("weather_stability", "Weather stability", 0.10, "historical_incident_risk"),
]
MIN_WEIGHT_SHARE = 0.5


def band(score: float) -> str:
    return "Low" if score <= 40 else "Moderate" if score <= 65 else "High" if score <= 85 else "Excellent"


def compute(factors: list[FactorResult]) -> dict:
    by = {f.key: f for f in factors}
    parts, got, total, acc = [], 0.0, 0.0, 0.0
    for key, label, w, source in COMPONENTS:
        total += w
        f = by.get(source) if source else None
        if f is None or not f.available or f.value is None:
            why = ("Travel-advisory data is not integrated yet" if source is None
                   else f"{f.label if f else source} unavailable")
            parts.append({"key": key, "label": label, "weight": w, "score": None, "from_factor": source, "note": why})
            continue
        s = round(100 * (1 - f.value), 1)
        got += w
        acc += w * s
        parts.append({"key": key, "label": label, "weight": w, "score": s, "from_factor": source,
                      "note": f.explanation})
    share = got / total if total else 0
    if share < MIN_WEIGHT_SHARE:
        return {"score": None, "band": None, "provisional": True, "weight_available": round(share, 3),
                "components": parts, "explanation": "Not enough measured factors for a destination score"}
    score = round(acc / got, 1)
    missing = [p["label"] for p in parts if p["score"] is None]
    return {"score": score, "band": band(score), "provisional": bool(missing), "weight_available": round(share, 3),
            "components": parts,
            "explanation": (f"{score:.0f}/100 ({band(score)})" +
                            (f" — provisional, without: {', '.join(missing)}" if missing else ""))}
