"""Choose the shrinkage for a hazard climatology on validation years, test it once, and write the artefact.

    python -m app.ml.training.tune_climatology --hazard cyclone     (IBTrACS:  fit 1980-2012, validate 2013-2017, test 2018-)
    python -m app.ml.training.tune_climatology --hazard flood       (DFO:      fit 1985-2008, validate 2009-2014, test 2015-)

Selection is by validation log loss — log loss, unlike Brier, punishes a near-zero probability where the hazard then
happens. Options searched: shrinkage strength m (years) x regional kernel sigma, and an activity adjustment that scales
each year's prediction by the recent global rate (previous ACTIVITY_YEARS years / training years). The adjustment uses
past years only, so it is available at prediction time; it exists because the flood archive's reporting effort changed
over time. The chosen setting is then reported on the test years (used for nothing else) and the artefact is rebuilt
from ALL years.

Predictions depend only on (cell, week of year, year), so metrics are computed from counts.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd

from app.ml import hazard_climatology as hc
from app.ml.datasets import cyclones, floods
from app.ml.training.train_cyclone import MODEL_DIR, REPORT_DIR, count_tables

M_GRID = [0, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512]
SIGMA_GRID = [150, 200, 300, 400, 600, 1000, 1500, 2000]
BANDS = [0, 1e-9, 0.002, 0.01, 0.03, 0.06, 0.1, 0.2, 1.01]
ACTIVITY_YEARS = 5


@dataclass(frozen=True)
class Hazard:
    name: str
    data_dir: Path
    window_start: Callable
    train_end: int
    val_end: int
    activity_options: tuple[bool, ...]


HAZARDS = {
    "cyclone": Hazard(hc.CYCLONE, cyclones.OUT_DIR, cyclones.window_start, 2012, 2017, (False,)),
    "flood": Hazard(hc.FLOOD, floods.OUT_DIR, floods.window_start, 2008, 2014, (False, True)),
}


def load(hz: Hazard):
    return (pd.read_csv(hz.data_dir / "grid.csv"), pd.read_csv(hz.data_dir / "positives.csv.gz"),
            json.loads((hz.data_dir / "meta.json").read_text()))


def metrics(p: np.ndarray, k: np.ndarray, n: np.ndarray) -> dict:
    """p, k: cells x weeks x years; n: weeks x years (windows per week, same for every cell)."""
    N = np.broadcast_to(n, k.shape)
    p = np.broadcast_to(p, k.shape)
    q = np.clip(p, 1e-6, 1 - 1e-6)
    total = N.sum()
    brier = float((N * p ** 2 - 2 * p * k + k).sum() / total)
    ll = float(-(k * np.log(q) + (N - k) * np.log(1 - q)).sum() / total)
    bands = []
    for a, b in zip(BANDS[:-1], BANDS[1:]):
        m = (p >= a) & (p < b) & (N > 0)
        if m.any():
            bands.append({"band": f"{a:g}-{b:g}", "windows": int(N[m].sum()),
                          "predicted": round(float((p * N)[m].sum() / N[m].sum()), 5),
                          "observed": round(float(k[m].sum() / N[m].sum()), 5)})
    ece = sum(b["windows"] * abs(b["predicted"] - b["observed"]) for b in bands) / total
    return {"brier": round(brier, 7), "log_loss": round(ll, 6), "ece_bands": round(float(ece), 6),
            "prevalence": round(float(k.sum() / total), 5), "bands": bands}


def yearly_rate(counts: np.ndarray, nwin: np.ndarray) -> np.ndarray:
    """Global share of cell-windows that were positive, per year."""
    return counts.sum(axis=(0, 1)) / np.maximum(counts.shape[0] * nwin.sum(0), 1)


def activity_ratio(rate: np.ndarray, year_idx: np.ndarray, base_idx: np.ndarray) -> np.ndarray:
    """For each target year: mean rate over the previous ACTIVITY_YEARS years / mean rate over the base years."""
    base = rate[base_idx].mean()
    return np.array([rate[max(0, y - ACTIVITY_YEARS):y].mean() / base for y in year_idx])


def tune(hz: Hazard) -> dict:
    grid, pos, meta = load(hz)
    n_windows = meta["windows"]["count"]
    counts, nwin, y0 = count_tables(grid, pos, n_windows, hz.window_start)
    y_last = int(hz.window_start(n_windows - 1).year)
    idx = lambda a, b: np.arange(a, b + 1) - y0
    tr, va, te = idx(y0, hz.train_end), idx(hz.train_end + 1, hz.val_end), idx(hz.val_end + 1, y_last)
    k_train, n_train = hc.tables(counts, nwin, tr)
    rate = yearly_rate(counts, nwin)
    lat, lon = grid["lat"].to_numpy(), grid["lon"].to_numpy()

    def score(m, sigma, activity, years):
        p = hc.estimate(grid, k_train, n_train, lat, lon, m, sigma)[:, :, None]
        if activity:
            p = np.clip(p * activity_ratio(rate, years, tr)[None, None, :], 0, 1)
        return metrics(p, counts[:, :, years], nwin[:, years])

    results = []
    for activity in hz.activity_options:
        results.append({"m": 0, "prior_sigma_km": 0, "activity": activity, **score(0, 0, activity, va)})
        for sigma in SIGMA_GRID:
            for m in (m for m in M_GRID if m > 0):        # m = 0 does not depend on sigma
                results.append({"m": m, "prior_sigma_km": sigma, "activity": activity, **score(m, sigma, activity, va)})
    best = min(results, key=lambda r: r["log_loss"])
    base = next(r for r in results if r["m"] == 0 and not r["activity"])
    print(f"[{hz.name}] validation: unshrunk log loss {base['log_loss']:.6f}; best {best['log_loss']:.6f} at "
          f"m={best['m']} sigma={best['prior_sigma_km']} activity={best['activity']}")
    for a in hz.activity_options:
        top = min((r for r in results if r["activity"] == a), key=lambda r: r["log_loss"])
        print(f"   best with activity={a}: m={top['m']} sigma={top['prior_sigma_km']} log loss={top['log_loss']:.6f}")
    test = {"chosen": score(best["m"], best["prior_sigma_km"], best["activity"], te), "unshrunk": score(0, 0, False, te)}
    for name, t in test.items():
        print(f"test {name:9s} log loss={t['log_loss']:.6f} brier={t['brier']:.7f} ece={t['ece_bands']:.6f}")
        for b in t["bands"]:
            print(f"    {b['band']:>12} n={b['windows']:>9,} predicted={b['predicted']:.5f} observed={b['observed']:.5f}")

    # Artefact from every year, same setting. With the activity adjustment the stored counts are rescaled to the
    # most recent ACTIVITY_YEARS years' global rate, i.e. the same ratio applied as at prediction time.
    alls = idx(y0, y_last)
    k_all, n_all = hc.tables(counts, nwin, alls)
    ratio = float(activity_ratio(rate, np.array([len(rate)]), alls)[0]) if best["activity"] else 1.0
    out = {"built_at": datetime.now(timezone.utc).isoformat(), "hazard": hz.name, "years": [int(y0), y_last],
           "target": meta["label"], "activity_ratio_applied": round(ratio, 4),
           "selection": (f"validation log loss over m x prior_sigma x activity (fit {y0}-{hz.train_end}, "
                         f"validate {hz.train_end + 1}-{hz.val_end}, test {hz.val_end + 1}-{y_last})"),
           "validation": best, "validation_unshrunk": base, "test": test, "sources": meta["sources"]}
    hc.save(MODEL_DIR, hz.name, grid, k_all * ratio, n_all, best["m"], best["prior_sigma_km"], out)
    REPORT_DIR.mkdir(exist_ok=True)
    (REPORT_DIR / f"{hz.name}_tuning.json").write_text(json.dumps({"grid_search": results, **out}, indent=1,
                                                                  default=lambda o: o.item()))
    print(f"wrote {MODEL_DIR / (hz.name + '.npz')}")
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--hazard", choices=sorted(HAZARDS), required=True)
    tune(HAZARDS[ap.parse_args().hazard])
