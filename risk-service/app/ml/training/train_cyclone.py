"""Train and evaluate the cyclone-exposure model on the IBTrACS dataset (app/ml/datasets/cyclones.py).

Target : P(cyclone >= 34 kt within 100 km of a place during a 7-day window), planned in advance.
Split  : by time only — train 1980-2012, validation 2013-2017 (all choices), test 2018-present (reported once).
         Every place on Earth has a track history, so the deployed question is "future years at known places";
         a spatial hold-out would test a situation that never occurs.
Leakage: climatology features for training rows exclude the row's own year; validation/test rows use training
         years only. ENSO is lagged two months. No storm information from inside the window is used.
Models : climatology (historical frequency at the place and week, the honest baseline), logistic regression,
         gradient boosting (unweighted so outputs stay probabilities), gradient boosting + isotonic calibration
         fitted on validation.
Gate   : the model is used only if, on the test years, it beats the climatology baseline on Brier score (skill > 0)
         and PR-AUC, and its expected calibration error is below MAX_ECE.

Usage: python -m app.ml.training.train_cyclone
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from app.core.config import SERVICE_ROOT
from app.ml.datasets.cyclones import OUT_DIR, load_oni, window_start
from app.ml.evaluation.metrics import best_f1_threshold, evaluate
from app.ml.preprocessing.cyclone_features import (FEATURES, KERNELS, WEEKS, apply_kernel, kernel_weights, oni_lag2,
                                                   place_features, smooth_weeks, time_features, week_of_year)

MODEL_DIR = SERVICE_ROOT / "models"
REPORT_DIR = SERVICE_ROOT / "reports"
TRAIN_END, VAL_END = 2012, 2017
SEED = 42
MAX_ECE = 0.002          # mean |predicted - observed| over probability bins, weighted by bin size


def load():
    grid = pd.read_csv(OUT_DIR / "grid.csv")
    pos = pd.read_csv(OUT_DIR / "positives.csv.gz")
    meta = json.loads((OUT_DIR / "meta.json").read_text())
    return grid, pos, meta


def count_tables(grid, pos, n_windows, starts_of=window_start):
    """counts[cell, week_of_year, year] of positive windows and windows[week_of_year, year] (how many exist).
    `starts_of` maps window indices to start dates (each dataset has its own origin)."""
    starts = starts_of(np.arange(n_windows))
    years = starts.year.to_numpy()
    y0, y1 = years.min(), years.max()
    woy = week_of_year(starts)
    nwin = np.zeros((WEEKS, y1 - y0 + 1))
    np.add.at(nwin, (woy, years - y0), 1)
    counts = np.zeros((len(grid), WEEKS, y1 - y0 + 1))
    np.add.at(counts, (pos["cell"].to_numpy(), woy[pos["window"]], years[pos["window"]] - y0), 1)
    return counts, nwin, y0


def climatology(counts, nwin, y0, years: list[int]):
    """Smoothed frequency per (cell, week) over the given years: cells x weeks."""
    sel = np.array(years) - y0
    return smooth_weeks(counts[:, :, sel].sum(2)) / np.maximum(smooth_weeks(nwin[None, :, sel].sum(2)), 1e-9)


def frame(grid, pos, n_windows, oni, counts, nwin, y0):
    """Dense cell x window table with features and labels."""
    starts = window_start(np.arange(n_windows))
    years, woy = starts.year.to_numpy(), week_of_year(starts)
    train_years = list(range(y0, TRAIN_END + 1))
    n_cells = len(grid)
    weights = {k: kernel_weights(grid, grid["lat"].to_numpy(), grid["lon"].to_numpy(), s) for k, s in KERNELS.items()}

    # training rows: leave-one-year-out sums; others: all training years
    sel = np.array(train_years) - y0
    tot_c, tot_n = counts[:, :, sel].sum(2), nwin[:, sel].sum(1)
    clim = {}
    for name, w in weights.items():
        num_all = apply_kernel(w, smooth_weeks(tot_c))                                      # cells x weeks
        den_all = smooth_weeks(tot_n[None, :])[0]
        per_year = apply_kernel(w, smooth_weeks(counts[:, :, sel], axis=1).reshape(n_cells, -1)).reshape(n_cells, WEEKS, -1)
        per_year_n = smooth_weeks(nwin[None, :, sel], axis=1)[0]                              # weeks x years
        col = np.empty((n_cells, n_windows))
        for j in range(n_windows):
            if years[j] <= TRAIN_END:
                k = years[j] - y0
                col[:, j] = (num_all[:, woy[j]] - per_year[:, woy[j], k]) / (den_all[woy[j]] - per_year_n[woy[j], k])
            else:
                col[:, j] = num_all[:, woy[j]] / den_all[woy[j]]
        clim[name] = col

    cell = np.repeat(np.arange(n_cells), n_windows)
    window = np.tile(np.arange(n_windows), n_cells)
    df = pd.DataFrame({"cell": cell, "window": window, "year": years[window]})
    for k, v in place_features(grid["lat"].to_numpy(), grid["lon"].to_numpy(), grid["coast_km"].to_numpy()).items():
        df[k] = np.repeat(v, n_windows)
    for k, v in time_features(starts).items():
        df[k] = np.tile(v, n_cells)
    df["oni_lag2"] = np.tile(oni_lag2(starts, oni), n_cells)
    for k, v in clim.items():
        df[k] = v.ravel()
    key = pos["cell"].to_numpy() * n_windows + pos["window"].to_numpy()
    df["y"] = 0
    df["y64"] = 0
    df.loc[key, "y"] = 1
    df.loc[key, "y64"] = pos["y64"].to_numpy()
    df[FEATURES] = df[FEATURES].astype("float32")
    return df


def reliability(y, p, bins=10) -> tuple[list[dict], float]:
    """Quantile bins over positive predictions; ECE weighted by bin size."""
    edges = np.unique(np.quantile(p, np.linspace(0, 1, bins + 1)))
    if len(edges) < 2:                       # constant predictions: one bin
        edges = np.array([edges[0], edges[0]])
    which = np.clip(np.searchsorted(edges, p, side="right") - 1, 0, len(edges) - 2)
    rows, ece = [], 0.0
    for b in range(len(edges) - 1):
        m = which == b
        if m.any():
            rows.append({"predicted": round(float(p[m].mean()), 5), "observed": round(float(y[m].mean()), 5),
                         "n": int(m.sum())})
            ece += m.mean() * abs(p[m].mean() - y[m].mean())
    return rows, round(float(ece), 6)


def score_set(y, y64, p, threshold, base_brier):
    out = evaluate(y, p, threshold, y64)
    out["log_loss"] = round(float(log_loss(y, np.clip(p, 1e-6, 1 - 1e-6))), 6)
    brier = float(np.mean((p - y) ** 2))           # unrounded; evaluate() rounds for display
    out["brier_skill_vs_climatology"] = round(1 - brier / base_brier, 4) if base_brier else None
    out["reliability"], out["ece"] = reliability(y, p)
    return out


class Calibrated:
    """Gradient boosting followed by an isotonic map fitted on validation (picklable, sklearn-like)."""
    def __init__(self, model, iso):
        self.model, self.iso = model, iso

    def predict_proba(self, X):
        p = self.iso.predict(self.model.predict_proba(X)[:, 1])
        return np.column_stack([1 - p, p])


class Climatology:
    def fit(self, X, y):
        return self

    def predict_proba(self, X):
        p = np.clip(np.asarray(X["clim_local"], dtype=float), 0, 1)
        return np.column_stack([1 - p, p])


def main() -> None:
    grid, pos, meta = load()
    n_windows = meta["windows"]["count"]
    oni = load_oni()
    counts, nwin, y0 = count_tables(grid, pos, n_windows)
    df = frame(grid, pos, n_windows, oni, counts, nwin, y0)
    df = df.dropna(subset=["oni_lag2"])
    parts = {"train": df[df.year <= TRAIN_END], "validation": df[(df.year > TRAIN_END) & (df.year <= VAL_END)],
             "test": df[df.year > VAL_END]}
    for k, v in parts.items():
        print(f"{k:10s} rows={len(v):,} positives={int(v.y.sum()):,} ({v.y.mean():.5f}) years {v.year.min()}-{v.year.max()}")

    gb = HistGradientBoostingClassifier(max_iter=500, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=200,
                                        l2_regularization=1.0, early_stopping=True, validation_fraction=0.1,
                                        random_state=SEED)
    candidates = {
        "climatology": Climatology(),
        "logistic_regression": make_pipeline(StandardScaler(), LogisticRegression(max_iter=3000, C=1.0)),
        "gradient_boosting": gb,
    }
    X = {k: v[FEATURES] for k, v in parts.items()}
    y = {k: v["y"].to_numpy() for k, v in parts.items()}
    y64 = {k: v["y64"].to_numpy() for k, v in parts.items()}
    preds = {}
    for name, m in candidates.items():
        m.fit(X["train"], y["train"])
        preds[name] = {k: m.predict_proba(X[k])[:, 1] for k in parts}
        print(f"  fitted {name}")
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(preds["gradient_boosting"]["validation"], y["validation"])
    candidates["gradient_boosting_calibrated"] = Calibrated(gb, iso)
    preds["gradient_boosting_calibrated"] = {k: candidates["gradient_boosting_calibrated"].predict_proba(X[k])[:, 1] for k in parts}

    results = {}
    base = {k: float(np.mean((preds["climatology"][k] - y[k]) ** 2)) for k in ("validation", "test")}
    for name in candidates:
        thr = best_f1_threshold(y["validation"], preds[name]["validation"])
        results[name] = {"threshold_from_validation": thr,
                         **{k: score_set(y[k], y64[k], preds[name][k], thr, base[k]) for k in ("validation", "test")}}
        t = results[name]["test"]
        print(f"{name:30s} test PR-AUC={t['pr_auc']} ROC-AUC={t['roc_auc']} Brier={t['brier']} "
              f"BSS={t['brier_skill_vs_climatology']} ECE={t['ece']} recall={t['recall']} prec={t['precision']}")

    learned = [n for n in candidates if n != "climatology"]
    best = min(learned, key=lambda n: results[n]["validation"]["brier"])   # chosen on validation only
    t, c = results[best]["test"], results["climatology"]["test"]
    checks = {"brier_skill_vs_climatology_gt_0": (t["brier_skill_vs_climatology"] or 0) > 0,
              "pr_auc_above_climatology": (t["pr_auc"] or 0) > (c["pr_auc"] or 0),
              f"ece_below_{MAX_ECE}": t["ece"] < MAX_ECE}
    passed = all(checks.values())
    # The baseline is itself a probability model; record whether it is calibrated on years it never saw
    climatology_calibrated = c["ece"] < MAX_ECE
    importance = None
    if best.startswith("gradient_boosting"):
        from sklearn.inspection import permutation_importance
        sample = parts["validation"].sample(200_000, random_state=SEED)
        r = permutation_importance(gb, sample[FEATURES], sample["y"], scoring="neg_brier_score", n_repeats=3,
                                   random_state=SEED)
        importance = {f: round(float(v), 7) for f, v in sorted(zip(FEATURES, r.importances_mean), key=lambda kv: -kv[1])}

    MODEL_DIR.mkdir(exist_ok=True)
    REPORT_DIR.mkdir(exist_ok=True)
    path = MODEL_DIR / "cyclone_exposure_model.joblib"
    all_years = list(range(y0, int(window_start(n_windows - 1).year) + 1))
    joblib.dump({"model": candidates[best], "climatology": {"years": [y0, all_years[-1]],
                                                            "table": climatology(counts, nwin, y0, all_years)}}, path)
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    model_meta = {
        "model_id": f"cyclone-exposure-{best.replace('_', '-')}-{datetime.now(timezone.utc):%Y%m%d}",
        "algorithm": best, "features": FEATURES, "trained_at": datetime.now(timezone.utc).isoformat(),
        "target": meta["label"], "artifact_sha256": sha,
        "split": {"train": f"{y0}-{TRAIN_END}", "validation": f"{TRAIN_END + 1}-{VAL_END}", "test": f"{VAL_END + 1}-"},
        "metrics": {"validation": results[best]["validation"], "test": t, "climatology_test": c},
        "gate": {"passed": passed, "checks": checks},
        "climatology_baseline": {"calibrated_on_test": climatology_calibrated, "test_ece": c["ece"],
                                 "test_roc_auc": c["roc_auc"], "test_pr_auc": c["pr_auc"]},
        "permutation_importance_brier": importance,
        "dataset": {k: meta[k] for k in ("grid", "windows", "tracks", "rows", "positives", "prevalence", "sources")},
        "limitations": [
            "Hazard probability, not harm: says nothing about injury, damage or travel disruption.",
            "Defined only within 45 degrees of the equator and 200 km of land; points between grid cells are interpolated.",
            "Recent IBTrACS tracks are provisional; wind conversions between agencies add uncertainty.",
            "Seasonal planning tool: for a storm already forecast, official advisories (GDACS/NHC/JTWC) take precedence.",
        ],
    }
    (MODEL_DIR / "cyclone_exposure_model.json").write_text(json.dumps(model_meta, indent=1, default=str))
    (REPORT_DIR / "cyclone_evaluation.json").write_text(json.dumps({"selected": best, "results": results,
                                                                    "gate": model_meta["gate"],
                                                                    "permutation_importance_brier": importance},
                                                                   indent=1, default=str))
    print(f"\nselected {best} by validation Brier; gate passed: {passed} {checks}")
    print("importance:", importance)


if __name__ == "__main__":
    main()
