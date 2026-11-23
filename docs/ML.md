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

---

# Cyclone exposure model (IBTrACS)

**Status (2026-11-23): in use.** The learned models do not beat historical frequency and are withheld by their gate.
The historical-frequency (climatology) model, pulled towards each place's region (see *Regional shrinkage*), is
calibrated on years it never saw. Factor 6 reports its probability, and factor 5 quotes it in the cyclone-season text.
It does not change any factor's class or the risk category.

## Question

*If I am at this place for this 7-day window, what is the chance that a cyclone with tropical-storm-force winds
(≥ 34 kt, 1-minute sustained) passes within 100 km?* This is a planning question asked weeks or months ahead, so only
information available before the trip is used. It is a hazard probability, not a probability of harm.

## Data (all free, public; downloads are git-ignored under `risk-service/data/`)

| Source | Use | Licence |
|---|---|---|
| IBTrACS v04r01 since-1980 CSV (NOAA NCEI, 145 MB) | every agency's best tracks, 4,860 storms, 274,832 fixes, 1980-01 → 2026-11-22 | US Government, free; cite Knapp et al. (2010) |
| Natural Earth 1:50m land | coastal grid, signed distance to coast | public domain |
| NOAA CPC Oceanic Niño Index | ENSO state | public domain |

Winds: `USA_WIND` (1-minute) when present, otherwise the agency's 10-minute `WMO_WIND` ÷ 0.88 (NHC/CPHC values are
already 1-minute). Spur tracks are dropped; recent *provisional* tracks are kept. Tracks are interpolated to hourly
fixes, unwrapping longitude across the dateline, so a fast storm cannot skip over a place between 3- or 6-hourly fixes.

## Dataset (`python -m app.ml.datasets.cyclones`, ~45 s)

* **Places:** 2° grid between 45° S and 45° N, cell centre within 200 km of land: 3,240 cells (2,099 on land). Chosen
  without looking at where storms went, unlike the GDACS experiment, so prevalence reflects ordinary places.
* **Windows:** consecutive 7-day windows from Monday 1980-01-07: 2,445 complete windows.
* **Labels:** 7.92 M cell-windows; 12,196 positive (0.154 %), 4,460 with ≥ 64 kt (hurricane/typhoon force).
  Yearly positives are steady (188–354, median 254) and include 2026.
* **Checks against known storms:** Andrew (Miami, 145 kt), Katrina (New Orleans, 110 kt) and Fani (Odisha, 128 kt) are
  labelled. Haiyan crossed Leyte midway between the 10° N and 12° N cell centres, 111 km from each. It is not a positive
  for those two cells, but it labels 12 other cells with winds up to 170 kt. Cell centres are sample points; the model
  is queried at any coordinate.

## Features (`preprocessing/cyclone_features.py`, shared with inference)

Latitude, longitude (sin/cos), signed distance to coast, time of year (sin/cos), ONI of the 3-month season centred two
months before the window (already published at planning time; missing is left missing, not guessed). Also historical
frequency of positive windows at that week of year (±2-week circular smoothing), kernel-weighted over grid cells at
σ = 75 km (the place) and σ = 150 km (the region).

## Leakage controls

* Split by time only: train 1980–2012, validation 2013–2017 (every choice), test 2018–2026 (reported once). Every place
  on Earth has a track history, so "future years at known places" is the deployed situation; a spatial hold-out would
  test a case that never occurs.
* Historical-frequency features for a training row leave out that row's own year (tested); validation and test rows
  use training years only.

## Results (`reports/cyclone_evaluation.json`)

Test = 2018–2026, 1,500,120 cell-windows, 2,549 positive (prevalence 0.170 %).

| Model | PR-AUC | ROC-AUC | Brier | Brier skill vs climatology | ECE |
|---|---|---|---|---|---|
| **Climatology** (historical frequency at place and week) | **0.035** | 0.935 | 0.00166 | 0 (reference) | 0.00020 |
| Logistic regression | 0.032 | 0.902 | 0.00171 | −0.028 | 0.00048 |
| Gradient boosting | 0.034 | **0.958** | 0.00166 | −0.000 | 0.00026 |
| Gradient boosting + isotonic (selected on validation Brier) | 0.033 | 0.957 | 0.00167 | −0.003 | 0.00023 |

Permutation importance (validation, Brier): the two historical-frequency features dominate, then latitude, longitude,
coast distance and season. ENSO adds almost nothing at this resolution.

**Gate** (`train_cyclone.py`): a learned model is used only if, on the test years, it beats climatology on Brier score
and PR-AUC, and its ECE is below 0.002. Gradient boosting ranks a little better (ROC-AUC 0.958 vs 0.935) but has no
Brier skill and a lower PR-AUC, so it **fails and is withheld**.

**Climatology calibration on the test years** (fixed bands of predicted probability per week):

| Predicted | Windows | Mean predicted | Observed | Observed ≥ 64 kt |
|---|---|---|---|---|
| 0 | 1,287,417 | 0 | 0.0001 | 0.0000 |
| (0, 0.2 %) | 80,083 | 0.0002 | 0.0034 | 0.0007 |
| 0.2–1 % | 61,753 | 0.0060 | 0.0062 | 0.0015 |
| 1–3 % | 49,870 | 0.0177 | 0.0174 | 0.0061 |
| 3–6 % | 17,255 | 0.0415 | 0.0378 | 0.0167 |
| 6–10 % | 3,517 | 0.0718 | 0.0577 | 0.0287 |
| ≥ 10 % | 225 | 0.1301 | 0.0978 | 0.0311 |

Calibrated from 0.2 % to 6 %. It overestimates the highest bands somewhat. It badly underestimates places with almost
no history: a near-zero history did not mean near-zero risk in 2018–2026 (17 times more storms than predicted).

## Regional shrinkage (`app/ml/cyclone_climatology.py`, `training/tune_cyclone_climatology.py`)

A place's own record is pulled towards its region's (empirical Bayes):
p = (k + m · prior) / (n + m), where k = storm weeks near the place (σ = 75 km), n = weeks observed, prior = regional
frequency (kernel σ). m (in years) and σ were chosen on validation log loss (fit 1980–2012, validate 2013–2017). Log
loss, unlike Brier, punishes a near-zero probability where a storm then happens.

Searched m ∈ {0 … 512} × σ ∈ {150 … 1000 km}. Chosen **m = 64, σ = 400 km**, an interior optimum on a flat ridge
(σ 300 km with m 128–256 is equal to 4 decimal places). The data favour mostly regional estimates: 33 years at one
place are too few, and cyclone exposure within 100 km varies smoothly in space.

Test years 2018–2026 (used once):

| | Log loss | Brier | ECE |
|---|---|---|---|
| Unshrunk climatology | 0.009774 | 0.0016619 | 0.00036 |
| **Shrunk (in use)** | **0.008906** | **0.0016583** | **0.00023** |

| Predicted | Windows | Mean predicted | Observed |
|---|---|---|---|
| 0 | 969,202 | 0 | 0.00002 |
| (0, 0.2 %) | 351,055 | 0.00039 | 0.00053 |
| 0.2–1 % | 111,359 | 0.0049 | 0.0053 |
| 1–3 % | 54,432 | 0.0170 | 0.0195 |
| 3–6 % | 12,866 | 0.0404 | 0.0466 |
| 6–10 % | 1,179 | 0.0678 | 0.0755 |
| ≥ 10 % | 27 | 0.103 | 0.037 (too few to judge) |

Places with almost no history are now about right (0.039 % vs 0.053 %, previously 0.02 % vs 0.34 %). Mid bands are
slightly low (about 0.85× observed). The artefact for use is rebuilt from all years 1980–2026 with the chosen setting.

Annual rate of a tropical storm or stronger within 100 km, and peak week: Okinawa 1.16 (late Aug), Manila 0.90
(Oct), Hong Kong 0.74 (late Aug), Tokyo 0.68 (Aug), Tacloban 0.65 (Dec), Miami 0.33 (Aug), Mumbai 0.04 (Nov),
Bali 0.01. Paris: outside the area (no estimate, not 0).

## Use in the engine

* **Factor 6 (historical):** `inputs.cyclone` holds the probability for the assessed period (journey window, or the
  next 7 days for a destination), the weekly probability, annual rate and peak week. The explanation states it, e.g.
  *"Cyclone history 1980–2026: 0.3% chance of a tropical storm or stronger passing within 100 km during the next 7
  days; about 0.33 per year here, most likely around 20 Aug"* (Miami, live run 2026-11-23).
* **Factor 5 (time):** inside an official basin season, the text adds how often a storm passed at this place in that
  week of the year. Basin boxes are broad: Tokyo in late November is "in season" at < 0.1 % per week.
* **Classes unchanged.** Without harm data, turning a probability into minor/moderate/severe would be a judgement.
  Missing artefact or outside the area → no probability, stated in the factor's notes, never 0.

## Interpretation

Forty-six years of real tracks give a cyclone probability that is calibrated on unseen future years over most of its
range. Machine learning on top of it adds nothing measurable for planning ahead. For a storm that already exists,
official advisories (GDACS, NHC, JTWC; factor 2) are far better than any climatology and take precedence.

## Reproduce

```bash
cd risk-service
mkdir -p data/ibtracs data/naturalearth data/enso
curl -C - -o data/ibtracs/ibtracs.since1980.csv \
  https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.since1980.list.v04r01.csv
curl -L -o data/naturalearth/ne_50m_land.zip https://naciscdn.org/naturalearth/50m/physical/ne_50m_land.zip
curl -o data/enso/oni.ascii.txt https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt
.venv/bin/python -m app.ml.datasets.cyclones       # ~45 s
.venv/bin/python -m app.ml.training.train_cyclone  # ~5 min; learned models vs climatology (evaluation only)
.venv/bin/python -m app.ml.training.tune_cyclone_climatology   # ~10 s; writes models/cyclone_climatology.* (used by the engine)
```

Models are git-ignored, so a deployed risk service must run these steps (or receive the 26 KB `cyclone_climatology.npz`
and its `.json`). Without them the engine still works and says the cyclone probability is unavailable.

Next: floods (GloFAS river discharge).
