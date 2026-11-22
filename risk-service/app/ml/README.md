# ML experiment — hazard-event classifier

**Status: trained and evaluated on real data. Experimental. Withheld from user-facing output: it does not pass the
evaluation gate.** It never sets a risk category.

## Why this target

There is no labelled dataset of traveller incidents, so a traveller-harm model cannot be trained or validated. What does
exist is an independent, official, impact-graded record of disasters (GDACS) and a global weather reanalysis (ERA5).
The experiment asks: *from the weather at a location, can we tell that a significant (GDACS Orange/Red) flood or
tropical-cyclone event is active within 100 km?* Labels and features come from different organisations, so the label is
not derived from the features.

## Dataset (built 2026-11-22, `python -m app.ml.datasets.build_dataset`)

| | |
|---|---|
| Labels | GDACS event API — 123 Orange/Red flood + cyclone events, 2022-01-01 … 2024-12-31 |
| Features | ERA5 daily (Open-Meteo archive): precipitation sum, max gust, max/min temperature |
| Locations | 111 — one per event cluster (0.5°, merged within 150 km) + the 10 TravelSphere destinations as controls |
| Rows | 77,387 location-days; 1,610 positive (2.1 %), 398 with a Red event |
| By year | 2022: 507 positive · 2023: 463 · 2024: 634 |
| Validation | no duplicates, no invalid coordinates, ranges checked, binary labels, y_red ⊆ y |

Nothing is synthetic. Known limitations: labels use event **centroids** (no historical polygons), so they are spatially
coarse; locations were chosen because events happened there; ERA5 (~25 km) is smoother than point forecasts, and
inference would use Open-Meteo forecasts (distribution shift).

A first build kept only the 45 most event-dense cells; ties fell back to GDACS's newest-first order, so 2024 dominated
and the 2023 validation set had 9 positives. That build was discarded and the selection rewritten to include every event.

## Features (`preprocessing/features.py`, shared by training and inference)

precip 1/3/7-day sums, max daily precip in 7 days, max gust 1/3 days, max temperature, diurnal range, day-of-year
(sin/cos), |latitude|. Backward-looking only (tested: changing future days does not change today's features).
No location id or longitude.

## Leakage controls

* Temporal: train 2022-01 … 2023-06 · validation 2023-07 … 2023-12 · test 2024 (never used for any choice).
* Spatial: 20 % of locations (stratified by having events) held out entirely; the **unseen-location 2024 test** is the
  headline estimate.
* Threshold chosen on validation (best F1); model chosen by validation PR-AUC.

## Results (`reports/ml_evaluation.json`)

Test = 2024, locations never seen in training (n = 4,026, 89 positive, prevalence 2.2 %).

| Model | PR-AUC | ROC-AUC | Precision | Recall | F1 | FPR | Red-event recall |
|---|---|---|---|---|---|---|---|
| Majority (dummy) | 0.022 | 0.500 | 0.022 | 1.000 | 0.043 | 1.000 | 1.000 |
| Rule baseline (IMD 64.5 mm/day or gust ≥ 24.5 m/s) | 0.026 | 0.521 | 0.085 | 0.056 | 0.068 | 0.014 | 0.100 |
| Logistic regression | 0.044 | 0.543 | 0.044 | 0.124 | 0.065 | 0.061 | 0.100 |
| **Random forest (selected)** | 0.043 | 0.647 | 0.106 | 0.056 | 0.073 | 0.011 | 0.075 |
| Gradient boosting | 0.051 | 0.620 | 0.076 | 0.225 | 0.114 | 0.061 | 0.300 |

Random-forest confusion matrix (unseen 2024): TN 3,895 · FP 42 · FN 84 · TP 5.
On 2024 data at **seen** locations the models do better (gradient boosting PR-AUC 0.098, ROC-AUC 0.75), so part of the
signal is location/season-specific and does not transfer.

SHAP (mean |value|, random forest, unseen test): |latitude| 0.086, season (cos) 0.068, max temperature 0.061,
season (sin) 0.059, 7-day precipitation 0.039, max 1-day precipitation in 7 days 0.036, 3-day max gust 0.033 …
The model leans on *where and when* more than on the weather itself.

## Interpretation

The learned models beat the published-threshold rule baseline and the dummy on ranking (PR-AUC about 2× prevalence on
unseen locations), so daily weather does carry some information about significant flood/cyclone activity. But at
usable thresholds they miss most event days (recall 6–22 %) with low precision. **This is not good enough to inform
safety decisions.**

## Evaluation gate (`config/scoring-v1.json → ml_gate`)

An ML signal is shown to users only if the unseen-location test PR-AUC is ≥ 3× prevalence **and** recall at the
validation threshold is ≥ 0.5. The current model (2.0×, 0.056) fails, so `ml_signal` reports
`available: false` with the reason, and `/internal/v1/status` shows the metrics.

## Reproduce

```bash
python -m app.ml.datasets.build_dataset --start 2022-01-01 --end 2024-12-31   # ~2k Open-Meteo call-equivalents; cached
python -m app.ml.training.train                                               # writes models/, reports/, registers model_versions
```

Likely improvements: historical GDACS polygons (exact footprints) instead of centroids; antecedent-rainfall
climatology anomalies computed on training years only; river-discharge features (GloFAS via Open-Meteo flood API) for
floods; cyclone track proximity for cyclones; more years.
