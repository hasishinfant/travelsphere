"""Train and evaluate hazard-event classifiers on the GDACS × ERA5 dataset.

Leakage controls
  temporal : train 2022-01-01 … 2023-06-30, validation 2023-07-01 … 2023-12-31, test 2024 (never used for any choice)
  spatial  : 20 % of locations are held out entirely; the test set is reported separately for SEEN and UNSEEN
             locations (unseen + future = the honest generalisation estimate)
  features : backward-looking windows only (see preprocessing/features.py); no location id, no longitude
Models: majority-class dummy, published-threshold rule baseline (IMD heavy rain 64.5 mm/day or Beaufort storm-force
gust 24.5 m/s), logistic regression, random forest, gradient boosting. Threshold chosen on validation (best F1).
Model selection by validation PR-AUC. SHAP (TreeExplainer) on the test set for the selected tree model.

Usage: python -m app.ml.training.train
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from app.core.config import SERVICE_ROOT
from app.ml.datasets.build_dataset import DATA_DIR
from app.ml.datasets.validate import clean, validate
from app.ml.evaluation.metrics import best_f1_threshold, evaluate
from app.ml.preprocessing.features import FEATURES, features_frame

MODEL_DIR = SERVICE_ROOT / "models"
REPORT_DIR = SERVICE_ROOT / "reports"
SEED = 42
TRAIN_END, VAL_END = pd.Timestamp("2023-06-30"), pd.Timestamp("2023-12-31")
HOLDOUT_SHARE = 0.2


class RuleBaseline:
    """Published thresholds, no learning: IMD 'heavy rain' ≥ 64.5 mm/day or Beaufort storm-force gust ≥ 24.5 m/s."""
    def fit(self, X, y):
        return self

    def predict_proba(self, X):
        x = pd.DataFrame(X, columns=FEATURES)
        hit = ((x["precip_1d_mm"] >= 64.5) | (x["gust_max_1d_ms"] >= 24.5)).astype(float).to_numpy()
        return np.column_stack([1 - hit, hit])


def split(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    rng = np.random.default_rng(SEED)
    locs = sorted(df["location_id"].unique())
    pos_locs = sorted(df.loc[df["y"] == 1, "location_id"].unique())
    neg_locs = [l for l in locs if l not in pos_locs]
    # stratified hold-out so the unseen-location test set also contains event locations
    held = set(rng.choice(pos_locs, max(1, int(len(pos_locs) * HOLDOUT_SHARE)), replace=False)) if pos_locs else set()
    if neg_locs:
        held |= set(rng.choice(neg_locs, max(1, int(len(neg_locs) * HOLDOUT_SHARE)), replace=False))
    d = pd.to_datetime(df["date"])
    seen = ~df["location_id"].isin(held)
    return {
        "train": df[seen & (d <= TRAIN_END)],
        "validation": df[seen & (d > TRAIN_END) & (d <= VAL_END)],
        "test_seen_locations": df[seen & (d > VAL_END)],
        "test_unseen_locations": df[~seen & (d > VAL_END)],
        "_held_out": pd.DataFrame({"location_id": sorted(held)}),
    }


def models() -> dict:
    return {
        "dummy_majority": DummyClassifier(strategy="prior"),
        "rule_baseline": RuleBaseline(),
        "logistic_regression": make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                                             LogisticRegression(class_weight="balanced", max_iter=2000, random_state=SEED)),
        "random_forest": make_pipeline(SimpleImputer(strategy="median"),
                                       RandomForestClassifier(n_estimators=400, min_samples_leaf=5, class_weight="balanced_subsample",
                                                              n_jobs=-1, random_state=SEED)),
        "gradient_boosting": HistGradientBoostingClassifier(max_iter=400, learning_rate=0.05, max_leaf_nodes=31,
                                                            class_weight="balanced", random_state=SEED),
    }


def shap_importance(model, X: pd.DataFrame) -> dict | None:
    try:
        import shap
    except ImportError:
        return None
    est = model[-1] if hasattr(model, "steps") else model
    Xt = model[:-1].transform(X) if hasattr(model, "steps") else X.to_numpy()
    sample = Xt[np.random.default_rng(SEED).choice(len(Xt), min(2000, len(Xt)), replace=False)]
    try:
        values = shap.TreeExplainer(est).shap_values(sample)
    except Exception as e:  # noqa: BLE001 — SHAP support differs per estimator/version
        print(f"SHAP unavailable for {type(est).__name__}: {e}")
        return None
    if isinstance(values, list):
        values = values[1]
    elif values.ndim == 3:
        values = values[:, :, 1]
    imp = np.abs(values).mean(axis=0)
    return {f: round(float(v), 5) for f, v in sorted(zip(FEATURES, imp), key=lambda kv: -kv[1])}


def main() -> None:
    raw = pd.read_csv(DATA_DIR / "hazard_event_dataset.csv.gz", parse_dates=["date"])
    raw["date"] = raw["date"].dt.date
    report = validate(raw)
    if report["hard_failures"]:
        raise SystemExit(f"dataset validation failed: {report['hard_failures']}")
    df = features_frame(clean(raw))
    df = df[pd.to_datetime(df["date"]) >= pd.Timestamp("2022-01-01")].dropna(subset=["precip_7d_mm"])
    parts = split(df)
    X = {k: v[FEATURES] for k, v in parts.items() if not k.startswith("_")}
    y = {k: v["y"].to_numpy() for k, v in parts.items() if not k.startswith("_")}
    y_red = {k: v["y_red"].to_numpy() for k, v in parts.items() if not k.startswith("_")}

    results = {}
    fitted = {}
    for name, m in models().items():
        m.fit(X["train"], y["train"])
        fitted[name] = m
        val_score = m.predict_proba(X["validation"])[:, 1]
        thr = 0.5 if name == "rule_baseline" else best_f1_threshold(y["validation"], val_score)
        results[name] = {"threshold_from_validation": thr,
                         "validation": evaluate(y["validation"], val_score, thr, y_red["validation"]),
                         **{k: evaluate(y[k], m.predict_proba(X[k])[:, 1], thr, y_red[k])
                            for k in ("test_seen_locations", "test_unseen_locations")}}
        print(f"{name:20s} val PR-AUC={results[name]['validation']['pr_auc']}  "
              f"test(unseen) F1={results[name]['test_unseen_locations']['f1']} "
              f"recall={results[name]['test_unseen_locations']['recall']} "
              f"FPR={results[name]['test_unseen_locations']['false_positive_rate']}")

    learned = ["logistic_regression", "random_forest", "gradient_boosting"]
    best = max(learned, key=lambda n: results[n]["validation"]["pr_auc"] or 0)
    model = fitted[best]
    thr = results[best]["threshold_from_validation"]
    beats_rule = (results[best]["test_unseen_locations"]["pr_auc"] or 0) > (results["rule_baseline"]["test_unseen_locations"]["pr_auc"] or 0)
    tree = best if best != "logistic_regression" else "random_forest"
    shap_imp = shap_importance(fitted[tree], X["test_unseen_locations"])
    if shap_imp is None and tree != "random_forest":
        tree = "random_forest"
        shap_imp = shap_importance(fitted[tree], X["test_unseen_locations"])

    MODEL_DIR.mkdir(exist_ok=True)
    REPORT_DIR.mkdir(exist_ok=True)
    path = MODEL_DIR / "hazard_event_model.joblib"
    joblib.dump(model, path)
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    meta = {
        "model_id": f"hazard-event-{best.replace('_', '-')}-{datetime.now(timezone.utc):%Y%m%d}",
        "description": f"Experimental {best} predicting GDACS Orange/Red flood/cyclone activity within 100 km from ERA5 daily weather",
        "algorithm": best, "target": "GDACS Orange/Red FL/TC event active within 100 km (centroid) on the day",
        "features": FEATURES, "threshold": thr, "trained_at": datetime.now(timezone.utc).isoformat(),
        "artifact_sha256": sha,
        "metrics": {"validation": results[best]["validation"], "test": results[best]["test_unseen_locations"],
                    "test_seen_locations": results[best]["test_seen_locations"]},
        "beats_rule_baseline_on_unseen_test_pr_auc": beats_rule,
        "dataset": {**{k: v for k, v in report.items() if k not in ("hard_failures",)},
                    "split": {k: int(len(v)) for k, v in parts.items() if not k.startswith("_")},
                    "held_out_locations": parts["_held_out"]["location_id"].tolist()},
        "shap_mean_abs": shap_imp, "shap_model": tree,
        "limitations": [
            "Labels use GDACS event centroids (no historical polygons): spatially coarse.",
            "Locations were selected because events happened there; prevalence differs from arbitrary places.",
            "Trained on ERA5 reanalysis; inference uses Open-Meteo forecasts (distribution shift).",
            "Score is not calibrated as a probability and says nothing about individual traveller harm.",
        ],
    }
    (MODEL_DIR / "hazard_event_model.json").write_text(json.dumps(meta, indent=1, default=str))
    (REPORT_DIR / "ml_evaluation.json").write_text(json.dumps({"selected": best, "results": results,
                                                               "dataset_validation": report, "shap_mean_abs": shap_imp},
                                                              indent=1, default=str))
    print(f"\nselected {best} (validation PR-AUC {results[best]['validation']['pr_auc']}); "
          f"beats rule baseline on unseen-location test PR-AUC: {beats_rule}")
    print("SHAP mean |value|:", shap_imp)
    try:
        from app.database import repository as repo
        if repo.db_available():
            repo.register_model({**meta, "metrics": meta["metrics"]})
            print("registered in model_versions (status experimental)")
    except Exception as e:  # noqa: BLE001
        print("model registry not updated:", e)

if __name__ == "__main__":
    main()
