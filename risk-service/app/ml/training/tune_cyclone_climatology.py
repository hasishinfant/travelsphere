"""Choose the shrinkage for the cyclone climatology on validation years, test it once, and write the artefact.

Fit on 1980-2012, choose (m, prior_sigma_km) by validation (2013-2017) log loss — log loss, unlike Brier, punishes a
near-zero probability where a storm then happens, which is the weakness being fixed. Then report the chosen setting
on 2018-present (test, used for nothing else) and write models/cyclone_climatology.* built from ALL years.

Predictions depend only on (cell, week of year), so metrics are computed from counts: per (cell, week),
k positives out of n windows.

Usage: python -m app.ml.training.tune_cyclone_climatology
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np

from app.ml.cyclone_climatology import estimate, save, tables
from app.ml.datasets.cyclones import window_start
from app.ml.training.train_cyclone import MODEL_DIR, REPORT_DIR, TRAIN_END, VAL_END, count_tables, load

M_GRID = [0, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512]
SIGMA_GRID = [150, 200, 300, 400, 600, 1000]
BANDS = [0, 1e-9, 0.002, 0.01, 0.03, 0.06, 0.1, 1.01]


def metrics(p: np.ndarray, k: np.ndarray, n: np.ndarray) -> dict:
    """p, k: cells x weeks; n: windows per week (same for every cell)."""
    N = np.broadcast_to(n, k.shape)
    q = np.clip(p, 1e-6, 1 - 1e-6)
    total = N.sum()
    brier = float((N * p ** 2 - 2 * p * k + k).sum() / total)
    ll = float(-(k * np.log(q) + (N - k) * np.log(1 - q)).sum() / total)
    bands = []
    for a, b in zip(BANDS[:-1], BANDS[1:]):
        m = (p >= a) & (p < b)
        if m.any():
            bands.append({"band": f"{a:g}-{b:g}", "windows": int(N[m].sum()),
                          "predicted": round(float((p * N)[m].sum() / N[m].sum()), 5),
                          "observed": round(float(k[m].sum() / N[m].sum()), 5)})
    ece = sum(b["windows"] * abs(b["predicted"] - b["observed"]) for b in bands) / total
    return {"brier": round(brier, 7), "log_loss": round(ll, 6), "ece_bands": round(float(ece), 6),
            "prevalence": round(float(k.sum() / total), 5), "bands": bands}


def main() -> None:
    grid, pos, meta = load()
    n_windows = meta["windows"]["count"]
    counts, nwin, y0 = count_tables(grid, pos, n_windows)
    y_last = int(window_start(n_windows - 1).year)
    yrs = lambda a, b: np.arange(a, b + 1) - y0
    k_train, n_train = tables(counts, nwin, yrs(y0, TRAIN_END))
    # raw (unsmoothed) outcomes for scoring
    obs = lambda a, b: (counts[:, :, yrs(a, b)].sum(2), nwin[:, yrs(a, b)].sum(1))
    k_val, n_val = obs(TRAIN_END + 1, VAL_END)
    k_test, n_test = obs(VAL_END + 1, y_last)
    lat, lon = grid["lat"].to_numpy(), grid["lon"].to_numpy()

    results = [{"m": 0, "prior_sigma_km": 0, **metrics(estimate(grid, k_train, n_train, lat, lon, 0, 0), k_val, n_val)}]
    for sigma in SIGMA_GRID:
        for m in (m for m in M_GRID if m > 0):          # m = 0 (no prior) does not depend on sigma
            p = estimate(grid, k_train, n_train, lat, lon, m, sigma)
            results.append({"m": m, "prior_sigma_km": sigma, **metrics(p, k_val, n_val)})
    for r in results:
        print(f"m={r['m']:>4} sigma={r['prior_sigma_km']:>4}  val log loss={r['log_loss']:.6f} brier={r['brier']:.7f} "
              f"ece={r['ece_bands']:.6f}")
    best = min(results, key=lambda r: r["log_loss"])
    base = next(r for r in results if r["m"] == 0)
    p_best = estimate(grid, k_train, n_train, lat, lon, best["m"], best["prior_sigma_km"])
    p_base = estimate(grid, k_train, n_train, lat, lon, 0, 0)
    test = {"chosen": metrics(p_best, k_test, n_test), "unshrunk": metrics(p_base, k_test, n_test)}
    print(f"\nchosen m={best['m']} prior_sigma={best['prior_sigma_km']} km (validation log loss)")
    for name, t in test.items():
        print(f"test {name:9s} log loss={t['log_loss']:.6f} brier={t['brier']:.7f} ece={t['ece_bands']:.6f}")
        for b in t["bands"]:
            print(f"    {b['band']:>12} n={b['windows']:>9,} predicted={b['predicted']:.5f} observed={b['observed']:.5f}")

    # Final artefact from every year, same setting
    k_all, n_all = tables(counts, nwin, yrs(y0, y_last))
    out = {"built_at": datetime.now(timezone.utc).isoformat(), "years": [int(y0), y_last], "target": meta["label"],
           "selection": "validation log loss over m x prior_sigma (fit 1980-2012, validate 2013-2017)",
           "validation": best, "validation_unshrunk": base, "test": test,
           "sources": meta["sources"]}
    save(MODEL_DIR, grid, k_all, n_all, best["m"], best["prior_sigma_km"], out)
    REPORT_DIR.mkdir(exist_ok=True)
    (REPORT_DIR / "cyclone_climatology_tuning.json").write_text(json.dumps({"grid_search": results, **out}, indent=1,
                                                                                  default=lambda o: o.item()))
    print(f"wrote {MODEL_DIR / 'cyclone_climatology.npz'}")


if __name__ == "__main__":
    main()
