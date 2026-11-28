# TravelSphere risk model (scoring-v2)

Version `scoring-v2`, engine in `risk-service/`, configuration in `risk-service/app/config/scoring-v2.json`.
This document explains what the model computes, from which data, and what it does **not** claim.

## 1. What the traveller gets

Every assessment, for a destination or for a traveller's own journey, returns three separate results:

| Output | Question it answers | Range | Decided by |
|---|---|---|---|
| **Risk level** | How dangerous are current conditions for this plan? | LOW · MODERATE · HIGH · CRITICAL | Explicit rules on the eight factors (§4) |
| **Confidence** | How far can this assessment be trusted? | 0–100 · high / medium / low | Quality of the data behind the factors (§5) |
| **Tourist Confidence Score** | How safe is this place to visit in general? | 0–100 · Low / Moderate / High / Excellent | Four background safety factors (§6) |

They are never merged. Good data does not make a place look safer, poor data does not make it look more dangerous,
and a calm day does not change a place's background score. Missing data is reported as missing, never as safe.

## 2. The eight factors

Each factor returns a value between 0 and 1 (higher means more risk), a severity class on a shared five-step scale
(none, minor, moderate, severe, extreme), its source and an explanation. Exposure is a modifier, so hazard exposure
has a value but no class.

| # | Dimension | Factor | Data | Class thresholds | Literature |
|---|---|---|---|---|---|
| 1 | Hazard | **Weather severity** | Open-Meteo forecast, hourly | Rain: AMS / Met Office. Gusts: Beaufort. Heat: NWS heat index. Cold: Environment Canada wind chill. WMO weather codes. Fog: WMO / NWS | Biardeau et al. 2026: intensity drives impact |
| 2 | Hazard | **Active hazards** | GDACS, USGS | Each hazard's own official scale: GDACS alert level, PAGER or magnitude class, cyclone wind buffers | Glorioso & Palaoag 2026: real-time alerts were the top-ranked feature |
| 3 | Exposure | **Hazard exposure** (replaces distance-to-hazard and route exposure) | Hazard footprints, OSRM route | Value = max(proximity, share of the route exposed). No class | Camatti et al. 2024; Li et al. 2026 |
| 4 | Exposure | **Terrain** (new) | Copernicus DEM GLO-90 via Open-Meteo, plus configured terrain features | FAO 2006 slope classes: < 10 % none, 10–15 % minor, 15–30 % moderate, 30–60 % severe, > 60 % extreme. Configured cliffs, glacial rivers and similar features count as at least minor | Li et al. 2026 (relief was the 3rd most important indicator); Alvarez et al. 2022 |
| 5 | Journey context | **Activity and timing** (replaces time factor) | Planned activity, NOAA solar position, cyclone seasons, forecast lead time | Moderate when ≥ 50 % of an open-air activity is after dark. Minor for any darkness or inside cyclone season | Camatti et al. 2024 |
| 6 | Journey context | **Hazard history** | GDACS orange/red events and USGS M ≥ 6 within 150 km over 10 years. IBTrACS and DFO climatologies | Return period: ≤ 1 yr extreme, ≤ 5 severe, ≤ 20 moderate, ≤ 100 minor | Biardeau et al. 2026 |
| 7 | Response capacity | **Access to emergency care** (promoted to a factor) | OpenStreetMap hospitals and clinics, OSRM drive time | ≤ 60 min none ("golden hour"), ≤ 120 min minor (Lancet Commission's 2-hour benchmark), else moderate | Glorioso & Palaoag 2026 (safety infrastructure weighted 0.53); Mawby & Ozascilar 2024 |
| 8 | Response capacity | **Remoteness** (new) | GeoNames `cities1000` | Distance to the nearest town of ≥ 5 000 people (the Degree of Urbanisation's town threshold): ≤ 10 km none, ≤ 25 minor, ≤ 50 moderate, else severe. **Bands are not calibrated** | Li et al. 2026: distance to towns was the **most important** indicator |

Changes from scoring-v1:

- **Distance to hazard** and **route exposure** measured the same thing, so they are merged into hazard exposure.
- **Population exposure** counts residents, which says how big a disaster is, not how much danger the traveller is
  in. It is now reported as context only.
- **Data reliability** described the evidence, not the danger. It is now the separate confidence measure.
- **Terrain**, **access to emergency care** and **remoteness** fill the gaps identified from Li et al. (2026) and the
  Design Project-I report's own response-accessibility dimension (Table 4.1).

## 3. Missing and stale data

- A factor without data has status `unavailable`. It is listed in `missing_indicators`, lowers confidence and is
  **never scored as zero**.
- Without weather **and** active-hazard data, no risk level is given (status `INCOMPLETE`).
- A weather observation older than its maximum age is marked stale. The assessment becomes `PARTIAL` and confidence
  can be at most medium.

## 4. Risk level: the rules

The level comes from rules, not from an average, so a violent storm cannot be diluted by calm factors. Every level
names the rule that produced it (`explanation.rules_applied`).

1. **Hazard base.** The base class is the higher of weather severity and active-hazard severity where the traveller is.
2. **Amplifiers.** These raise the class by **one step in total**, however many fire. There is no compounding.
   - **Exposed activity:** trekking or water activity in weather of moderate or worse.
   - **Hazardous terrain:** terrain of moderate or worse, a hazard of minor or worse, and an open-air activity
     (trekking, water or sightseeing).
   - **Weak response capacity:** a hazard of moderate or worse together with care more than 2 hours away, or a
     remote place (remoteness of moderate or worse).
3. **Context floor.** If most of an open-air activity is after dark, the level is at least MODERATE, but only on
   remote ground (remoteness minor or worse) or steep ground (terrain moderate or worse). Darkness in a lit city is
   not escalated.
4. **History never escalates.** It is susceptibility, not a current condition (Biardeau et al. 2026), so it is
   reported in the seasonal outlook but does not change the level.
5. **Critical override.** A verified red alert (GDACS, or USGS PAGER) that affects the location or route sets the
   level to CRITICAL.

Severity class maps to level as follows: none or minor → LOW, moderate → MODERATE, severe or extreme → HIGH.
Amplifiers never produce CRITICAL. Remoteness, poor access, steep terrain and history **on their own never raise the
level**: they make a hazard worse, but they are not a hazard.

A **composite index**, the equal-weight mean of the available factor values, is also returned. It is for ranking and
trends only and is not a probability.

## 5. Confidence in the assessment

`risk-service/app/risk_engine/confidence.py`

```
confidence = 100 × mean(credibility, freshness, completeness, precision, agreement)   (over the components available)
```

| Component | Calculation |
|---|---|
| Credibility | Mean tier score of the sources used: official 1.0, scientific model 0.85, community 0.65, configured 0.4 |
| Freshness | Worst freshness among time-sensitive sources: 1 within the source's maximum age, falling linearly to 0 at twice that age |
| Completeness | Factors with data ÷ applicable factors |
| Precision | Mean of: weather grid distance (1 at the point, 0 at ≥ 25 km); share of nearby hazards with real footprints; routed vs straight-line route; DEM terrain available; routed vs estimated drive time to care |
| Agreement | Share of cross-checks that agree (USGS vs GDACS earthquake class; weather code vs precipitation) |

Confidence levels:

- **high** at 80 or above, **medium** at 60 or above, otherwise **low**.
- **Capped at low** if weather severity or active hazards is unavailable.
- **Capped at medium** if any input is stale.

The tier scores and the equal averaging are conventions, not validated values. Confidence is shown next to every
result and never changes the risk level.

### What the traveller sees

Confidence is shown as **"How sure we are"**, never as "confidence". Travellers read "high confidence" as "safe to
go", but this score only describes the data behind the rating. The page states what the two together mean and
what to do:

| How sure | Meaning | What the app does |
|---|---|---|
| **Very sure** (≥ 80) | Complete, current data: trust the rating as it is, whether it says safe or dangerous | Shows the level normally. High risk + very sure says "the danger is real". |
| **Fairly sure** (60–79, or stale data) | Some information is missing or old | Shows the level, names the missing factors, and says to check again before going |
| **Not sure** (< 60, or no weather / hazard data) | Too little current information | Tags the level "not sure" and tells the traveller not to rely on it but to check official services |

So a place can be **High risk · very sure (92/100)**: we are confident it is dangerous. "How safe is the place in
general" is the separate Tourist Confidence Score.

## 6. Tourist Confidence Score (destination background)

`risk-service/app/risk_engine/aggregation/destination_score.py`. This is the manuscript's Tourist Confidence Index,
restricted to the four **safety** factors of the report's Table 6.4 and fed with measured data:

| Component | Weight | Measured by | Status |
|---|---|---|---|
| Safety index | 0.20 | Official travel-advisory level | **Not integrated yet** |
| Health and emergency care | 0.15 | Factor 7, access to emergency care | Measured |
| Transport access | 0.15 | Factor 8, remoteness | Measured |
| Weather stability | 0.10 | Factor 6, hazard history | Measured |

```
sᵢ = 100 × (1 − rᵢ)              rᵢ = the factor's 0–1 risk value
TCS = Σ wᵢ sᵢ / Σ wᵢ              over AVAILABLE components only (weights re-normalised, never filled in)
```

- A score is given only when the available components carry at least 50 % of the total weight.
- The score is marked **provisional** while any component is missing. Until advisories are integrated, every score
  is provisional.
- Bands, from the report: Low 0–40, Moderate 41–65, High 66–85, Excellent 86–100.
- The report's language, budget, crowd and preference factors describe trip fit, not safety, and are excluded.
- The weights keep the report's order (safety > health = transport > weather). The exact numbers are the team's
  choice and are to be replaced by an AHP survey, accepted only with a consistency ratio below 0.1.

## 7. What the model does not claim

- The risk level is not the probability of an accident or injury, and it is not an official warning.
- The amplifier rules, the remoteness bands and the weights have **not been calibrated** against traveller outcomes.
  No dataset of traveller harm is available.
- Coverage limits:
  - OpenStreetMap completeness varies by country.
  - GeoNames gives a point population, not a measured urban footprint.
  - A 90 m DEM sampled at 300 m under-estimates short steep features such as cliff edges.
  - The Copernicus DEM is a surface model that includes buildings and trees. Before this was handled, the first live
    run on 27 Nov 2026 gave Times Square a 38 % "slope". In built-up areas (a destination configured as urban, or a
    town of ≥ 100 000 people within 2 km), the DEM slope is therefore ignored and terrain comes from configured
    features only. Forest canopy is not corrected.
  - The public Overpass servers are often overloaded: a 25 km facility query for Paris took 57 s, against the 45 s
    deadline. Access to emergency care is then reported as unavailable (never as adequate). Production should warm
    the 30-day facility cache with a scheduled job, or run its own Overpass instance.

## 8. Validation plan

1. **Journey replay.** Replay past journeys against archived warnings and footprints, and check whether the level
   flagged the journeys that crossed an official warning area. A warning source used as a label must not also be an
   input; otherwise the test is circular.
2. **Ablation.** Remove one factor at a time and re-run the replay. A factor that never changes a result is a
   candidate for removal.
3. **Confidence check.** Check whether low-confidence assessments disagree with later observations more often than
   high-confidence ones.
4. **AHP** for the Tourist Confidence Score weights.
5. **User study** (n ≥ 30): do travellers understand the level, the confidence and the explanation?

## 9. Data setup

```
# GeoNames settlements (remoteness), about 11 MB, CC BY 4.0
mkdir -p risk-service/data/geonames
curl -o risk-service/data/geonames/cities1000.zip https://download.geonames.org/export/dump/cities1000.zip
```

The elevation API (Copernicus DEM via Open-Meteo) needs no key. Apply `supabase/migrations/0007_scoring_v2.sql`
before deploying the new risk service.
