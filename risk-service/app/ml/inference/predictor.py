"""Inference for the experimental hazard-event classifier (see docs/ML.md).

The model's output is reported as a separate, clearly-labelled signal. It does NOT change the risk category: it has
been evaluated only on its own target (GDACS Orange/Red flood/cyclone events near a location), its score is not a
calibrated traveller-risk probability, and forecast features (Open-Meteo) differ in distribution from the ERA5
reanalysis it was trained on. When no trained artefact exists, the signal is null and says why.
"""
from __future__ import annotations

import json
import logging
from datetime import timedelta
from functools import lru_cache
from pathlib import Path

import pandas as pd

from app.core.config import get_settings
from app.ml.preprocessing.features import FEATURES, features_from_daily

log = logging.getLogger("risk.ml")
ARTEFACT = "hazard_event_model.joblib"
META = "hazard_event_model.json"


@lru_cache
def _load(model_dir: str):
    path = Path(model_dir)
    if not (path / ARTEFACT).exists() or not (path / META).exists():
        return None, None
    import joblib
    try:
        return joblib.load(path / ARTEFACT), json.loads((path / META).read_text())
    except Exception as e:  # noqa: BLE001
        log.warning("could not load model: %s", e)
        return None, None


def reload() -> None:
    _load.cache_clear()


def gate(meta: dict) -> tuple[bool, str]:
    """Evaluation gate from the scoring config, applied to the unseen-location test metrics."""
    from app.risk_engine.aggregation.config import load_scoring
    g = load_scoring(get_settings().scoring_config)["ml_gate"]
    t = meta["metrics"]["test"]
    lift = (t["pr_auc"] or 0) / t["prevalence"] if t.get("prevalence") else 0
    ok = lift >= g["min_pr_auc_lift_unseen"] and t["recall"] >= g["min_recall_unseen"]
    return ok, (f"unseen-location test PR-AUC {t['pr_auc']} = {lift:.1f}x prevalence (needs {g['min_pr_auc_lift_unseen']}x), "
                f"recall {t['recall']} (needs {g['min_recall_unseen']})")


def status() -> dict:
    model, meta = _load(str(get_settings().model_dir))
    if model is None:
        return {"available": False, "reason": "No trained model artefact (run the training pipeline: see docs/ML.md)"}
    passed, why = gate(meta)
    return {"available": True, "model_id": meta["model_id"], "trained_at": meta["trained_at"], "status": "experimental",
            "passes_evaluation_gate": passed, "gate_detail": why, "test_metrics": meta["metrics"].get("test")}


def ml_signal(ctx) -> dict | None:
    model, meta = _load(str(get_settings().model_dir))
    if model is None:
        return {"available": False, "reason": "No trained model artefact"}
    passed, why = gate(meta)
    if not passed:
        return {"available": False, "model_id": meta["model_id"],
                "reason": f"Experimental model withheld: it did not pass the evaluation gate ({why})"}
    w = ctx.weather
    if w is None:
        return {"available": False, "reason": "Weather unavailable"}
    local_today = (ctx.now + timedelta(seconds=w.utc_offset_s)).date()
    feats = features_from_daily(local_today, w.daily_precip_mm, w.daily_gust_max_ms, w.daily_temp_max_c,
                                w.daily_temp_min_c, ctx.location.y)
    if feats is None:
        return {"available": False, "reason": "Not enough daily history (needs 7 past days) for model features"}
    x = pd.DataFrame([[feats[f] for f in FEATURES]], columns=FEATURES, dtype=float)  # named: column order can't drift
    score = float(model.predict_proba(x)[0, 1])
    thr = float(meta["threshold"])
    return {"available": True, "model_id": meta["model_id"], "status": "experimental",
            "target": meta["target"], "score": round(score, 4), "threshold": thr, "flagged": score >= thr,
            "features": {k: (None if v is None else round(v, 2)) for k, v in feats.items()},
            "test_metrics": meta["metrics"].get("test"),
            "note": "Experimental signal; not used for the risk category and not a probability of harm."}
