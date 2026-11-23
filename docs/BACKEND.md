# TravelSphere — Backend & Risk Intelligence Implementation

See also `risk-service/README.md` (running the service) and `docs/ML.md` (model experiment and results).

Status vocabulary: **Implemented** · **Partial** · **Credential-dependent** · **External-dependent** (works, but relies
on a free public service) · **Future**.

---

## 1. Architecture

```
Browser (existing React UI, unchanged)
   │  /api/*  (JWT: local dev or Supabase)
   ▼
Express 5 + TypeScript  (server/)                       ── public entry point
   • auth, Zod validation, rate limits, helmet, CORS
   • journeys, profile, incidents, alerts, devices, /api/v1/*
   • /api/places/* now served by the 8-factor engine (rules-v1 kept as labelled fallback)
   • FCM dispatcher (credential-dependent)
   │  POST /internal/v1/*   Bearer RISK_SERVICE_TOKEN, timeout, Zod-validated responses
   ▼
FastAPI risk service  (risk-service/)                   ── internal only (loopback/private network)
   ingestion → data quality → 8 factor modules → aggregation / journey context → explanations → persistence → alerts
   APScheduler jobs (reassessment, alert expiry, location purge, hazard archive refresh)
   │                                   │
   ▼                                   ▼
PostgreSQL 16 / Supabase (+PostGIS when available)   Open-Meteo · GDACS · USGS · OSRM · Overpass (keyless)
```

Destination and journey assessments are separate end to end: separate code paths, tables
(`destination_assessments` / `journey_assessments`) and endpoints.

## 2. Libraries and versions (installed and tested)

| Layer | Versions |
|---|---|
| Node API | Node 26, Express 5.3.0, TypeScript 5.9.3, Zod 4.6.7, pg 8.23.1, jose 6.2.15, helmet 8.3.0, express-rate-limit 8.7.3 |
| Node tests | Vitest 5.1.0, Supertest 7.3.1 |
| Python service | Python 3.12, FastAPI 0.115.6, Uvicorn 0.34.0, Pydantic 2.10.4, HTTPX 0.28.1, SQLAlchemy 2.0.36, psycopg 3.2.3 |
| Data / geo | Pandas 2.2.3, NumPy 2.1.3, Shapely 2.0.6, GeoPandas 1.0.1, PyProj 3.7.0 |
| ML | scikit-learn 1.6.0, SHAP 0.46.0, joblib 1.4.2 |
| Jobs | APScheduler 3.11.0 |
| Python tests | pytest 8.3.4, pytest-asyncio 0.25.0, respx 0.22.0 |
| Database | PostgreSQL 16.15 locally; Supabase Postgres in production |

Not used, deliberately: Alembic (would compete with the existing SQL migration runner for schema ownership), Supabase
JS client on the server (the server already uses `pg` with RLS via `withUser`), Redis/Celery/Kafka (no workload needs
them), NLP/LLMs/TensorFlow/PyTorch.

## 3. Implemented modules

**Python (`risk-service/app`)** — see `risk-service/README.md` for the tree.
`ingestion/` http client (timeouts, retries with backoff, Retry-After, per-host rate limiting, TTL cache, per-call
deadlines) and adapters for Open-Meteo forecast/geocoding/archive, GDACS (events + footprints), USGS (feed + FDSN),
OSRM (routes, alternatives, table), Overpass (3 mirrors) · `processing/data_quality.py` · `geospatial/` (geodesic,
AEQD projection, GeoPandas overlay, geodesic circles, NOAA solar position) · `risk_engine/factors/` (8 modules) ·
`risk_engine/aggregation/` · `risk_engine/journey_context/` · `risk_engine/explanations/` · `services/` (acquisition
with fallbacks, destination, journey, alerts) · `database/` · `background/scheduler.py` · `ml/`.

**Node (`server/src`)** — `integrations/riskService.ts` (client + Zod schemas), `integrations/fcm.ts` (FCM HTTP v1 +
dispatcher), `services/assessments.ts` (fresh-or-recompute, place-card mapping), `routes/v1/` (destinations,
assessments, incidents, alerts, devices), `routes/places.ts` (re-pointed to the engine).

## 4. Database schema and migrations

Migration `supabase/migrations/0004_risk_intelligence.sql` (0001–0003 untouched; applied by `server/src/migrate.ts`):

| Table | Purpose |
|---|---|
| `destinations` | 10 catalogue places (seeded from the former hard-coded profiles), timezone, assessment radius |
| `data_sources` | provider registry: credibility tier, max age, last success/failure, consecutive failures |
| `hazard_events` | normalised active + historical hazards (GDACS, USGS), GeoJSON footprint, validity period, verified flag |
| `safety_indicators` | normalised measurements per destination (weather, population) with timestamps and quality |
| `destination_assessments` | category, composite index, status, coverage, reliability, missing indicators, warnings, override, explanation, versions, inputs hash |
| `journey_assessments` | category, four dimensions, route summary + simplified geometry, safer route, party, window |
| `factor_assessments` | one row per factor per assessment (exactly one parent enforced) |
| `journey_locations` | consent-gated traveller positions with `expires_at` (retention) |
| `safety_alerts` | destination-wide or personal alerts; partial unique index = one active alert per recipient + dedup key |
| `assessment_history` | append-only timeline with previous category |
| `emergency_facilities`, `facility_searches` | 30-day OSM facility cache, including "searched, none found" |
| `hotel_bookings` (0005) | hotel bookings made through LiteAPI: owner, provider booking id, stay, price, status, cancellation fee/refund; owner/staff read, server-only writes |
| extended | `model_versions` (status, config, features, dataset, artefact hash), `incidents` (destination, hazard type, verified, verified_by, assigned_to), `notifications.safety_alert_id` |

Constraints: coordinate ranges, enums, validity ordering, one-parent rule, retention. Indexes on every lookup path.
**PostGIS:** enabled automatically when available (Supabase) — generated `geography` columns + GiST indexes on
destinations, hazards, facilities, incidents. The local Postgres 16 has no PostGIS package, so locally the B-tree
lat/lng indexes are used and exact geometry is computed in Shapely/PyProj (same results; tested).

**RLS:** public safety data readable by signed-in users and written only by the services; journey assessments,
journey factors and locations owner + staff; alerts own + broadcast, travellers may only update `status/acknowledged_at`
of their own (column grant); history: destination rows public, journey rows owner + staff.
Tests: `supabase/tests/rls_test.sql` (existing) and `supabase/tests/rls_risk_test.sql` (new).

## 5. API endpoints (Express, all JSON, `{error:{code,message,details?}}` on failure)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/health` (also `/api/health`) | database + risk-service status |
| GET | `/api/v1/destinations` | with latest category |
| GET | `/api/v1/destinations/:id/safety` | latest assessment if < `ASSESSMENT_MAX_AGE_MIN`, else recomputed |
| GET | `/api/v1/destinations/:id/factors` | the eight factor results |
| GET | `/api/v1/destinations/:id/history` | paginated (`limit`, `offset`) |
| POST | `/api/v1/assessments/destination` | force recompute (20/min/user) |
| POST | `/api/v1/assessments/journey` | `journey_id` and/or `destination_id`, `origin`, `current_location` (needs consent), `waypoints`, `travel_start/end`, `activity`, `travellers`, `transport_mode`; defaults derived from the stored journey |
| GET | `/api/v1/journeys/:id/assessment` | latest journey assessment (owner) |
| GET | `/api/v1/assessments/:id/explanation` | destination (anyone) or journey (owner/staff) |
| POST | `/api/v1/incidents` | 10 per 15 min; SOS ⇒ priority critical |
| GET | `/api/v1/incidents` | own; `scope=all` for responders; `status`, pagination |
| GET | `/api/v1/incidents/:id` | with update timeline |
| PATCH | `/api/v1/incidents/:id/status` | responders only; transition rules; `verified`, `assigned_to`, note; notifies reporter |
| POST | `/api/v1/incidents/:id/notes` | reporter or staff |
| GET | `/api/v1/alerts` | own + destination-wide; `status`, pagination |
| POST | `/api/v1/alerts/:id/acknowledge` | own alerts |
| POST / DELETE | `/api/v1/devices[/:id]` | FCM / web-push tokens |
| GET | `/api/v1/hotels/status` | whether hotel booking is configured, sandbox or production |
| POST | `/api/v1/hotels/search` | `city` + `country_code` (or `latitude`/`longitude`), `checkin`, `checkout`, `rooms[]` (adults, children ages); 30/min |
| GET | `/api/v1/hotels/:hotelId` | description, photos, facilities, check-in/out times |
| POST | `/api/v1/hotels/prebook` | `offer_id` → final price, price/terms changes |
| POST | `/api/v1/hotels/book` | `prebook_id`, holder, lead guest per room; recorded in `hotel_bookings`; 10 per 15 min |
| GET | `/api/v1/hotels/bookings`, `/bookings/:id` | own bookings (`from`/`to`); details include live provider status |
| POST | `/api/v1/hotels/bookings/:id/cancel` | own bookings; records fee and refund |
| GET | `/api/places/conditions`, `/api/places/:id/assessment` | existing UI endpoints, now fed by the engine (shape unchanged) |

## 6. Eight-factor methodology

Shared ordinal scale for hazard-side factors: none / minor / moderate / severe / extreme → 0 / .25 / .5 / .75 / 1
(ordinal encoding, not a ratio claim). Every factor returns: status (`measured`, `derived`, `configured`,
`not_applicable`, `unavailable`), value, class, raw value + unit, inputs, methodology, explanation, observed/computed
timestamps and data quality (sources, age, staleness, cache, missing fields, precision, notes). **Unavailable is never 0.**

| # | Factor | Inputs · source | Thresholds / method |
|---|---|---|---|
| 1 | Weather severity | Open-Meteo hourly + current: rain rate, gusts, apparent temp, WMO code, visibility | AMS/Met Office rain (2.5/7.6/16/50 mm/h), Beaufort gusts (10.8/17.2/24.5/32.7 m/s), NWS heat index (27/32/39/51 °C), Env. Canada wind chill (−10/−28/−40/−48 °C), WMO thunderstorm/freezing/snow codes, WMO/NWS fog (1000/400 m); worst driver over the period; journeys use each route point at its ETA |
| 2 | Hazard severity | GDACS events + footprints, USGS (merged duplicates), configured zones | official class: GDACS Green/Orange/Red → minor/severe/extreme; USGS PAGER or magnitude class; cyclone wind buffers 60/90/120 km/h → moderate/severe/extreme locally. Affects = footprint intersects subject, or point hazard within assessment radius, active in window. Active only (history is factor 6) |
| 3 | Distance to hazard | subject geometry vs hazard geometries | min geodesic/AEQD distance (0 inside); proximity = 1 − min(d,R)/R, R = assessment radius (scope parameter) |
| 4 | Route exposure | OSRM route vs footprints | GeoPandas overlay in local AEQD CRS; exposed m, fraction, minutes; overlaps counted once; destination ⇒ not applicable |
| 5 | Time factor | window, timezone, NOAA solar elevation, basin seasons, hazard validity, lead time | darkness share; NHC/JMA/IMD/Météo-France/BoM/Fiji cyclone seasons; ≥50 % dark during outdoor activity ⇒ moderate, any darkness or in season ⇒ minor |
| 6 | Historical incident risk | GDACS Orange/Red archive (10 y), USGS M ≥ 6, verified TravelSphere incidents, 150 km | Pandas clean/dedupe/classify; λ events/yr; P(≥1) = 1−e^(−λt) per year and per trip; class by return period (≤1/5/20/100 y). Frequency, not accident probability; incidents not normalised (no visitor denominators) |
| 7 | Population exposure | GeoNames locality population (Open-Meteo geocoding), affecting hazards, party size | exposed residents (locality inside an affecting hazard ≥ moderate) banded at 1k/100k/1M (GDACS exposure tiers); density unavailable (reported, not guessed); travellers exposed and traveller-hours reported separately |
| 8 | Data reliability | all of the above | mean of credibility (tier), freshness (per-source max age), completeness, precision (grid distance, footprint share, routed vs straight line), agreement (USGS vs GDACS magnitude ±0.3; weather code vs precipitation). Evidence quality; never part of the hazard score |

**Destination aggregation (`config/scoring-v1.json`).** Category = worst class of the primary current-hazard factors
(weather, active hazard) → LOW/LOW/MODERATE/HIGH/HIGH. A weighted mean would let a violent storm be diluted by calm
factors, so the composite index (equal weights, explicitly unvalidated) is reported separately for ranking/trends.
**Critical override:** a verified red alert (GDACS red / USGS PAGER red) affecting the location ⇒ CRITICAL. Status:
COMPLETE / PARTIAL (missing or stale inputs) / INCOMPLETE (no weather and no hazard data ⇒ no category, never LOW).

## 7. Geospatial methodology

WGS84 storage; no distance ever computed in degrees. Point–point: geodesic on the WGS84 ellipsoid (pyproj.Geod).
Geometry–geometry, lengths and intersections: azimuthal-equidistant projection centred on the area of interest
(exact radial distances, < 1 % distortion within a few hundred km; verified at 60° N in tests). Configured circular
zones become true-radius geodesic circles. Invalid polygons are repaired (`make_valid`). Route ∩ footprint uses a
GeoPandas overlay; per-hazard and union lengths are scaled to the geodesic route length. Routes come from OSRM (with
alternatives); if OSRM fails, a straight-line route is used and labelled with lower precision. Antimeridian-crossing
geometries are not supported (documented).

## 8. Journey-context methodology

Four dimensions organise the eight inputs: **Hazard** (weather at route start/middle/end at their ETAs and at the
destination; hazards touching the route), **Exposure** (route exposure, distance, activity, party), **Journey context**
(time factor, trip-window historical probability), **Response accessibility** (time to nearest hospital/clinic from
the least-served route point: OSRM table time, else straight line × 1.3 circuity at 40 km/h, labelled; ≤ 60 min
adequate — trauma golden-hour convention; ≤ 120 min limited — Lancet Commission 2-hour benchmark; else poor).
Rules: outdoor activity (trekking, water) with weather ≥ moderate ⇒ +1 class; darkness/season capped at MODERATE;
poor access with hazard ≥ moderate ⇒ +1 category; critical override. **Safer route:** OSRM alternatives are
intersected with the same footprints; recommended if exposure falls ≥ 25 %, with the extra minutes.
Verified live: same destination (Kyoto) → LOW for a daytime 4 km drive, MODERATE for a 13 km night walk (§11).

## 9. Explanations

Built only from computed results and the rules that fired: hazard detected, contributing inputs (sorted), location,
journey effect (route exposure, access, safer route), information age, recommended action (+ additional), rules applied,
missing information, status, and the disclaimer that the category/index is not a probability of an accident.

## 10. Machine learning and datasets

* **Labelled dataset:** none for traveller incidents. Built instead from real public data: GDACS Orange/Red flood +
  cyclone events (labels) × ERA5 daily weather (features) — 77,387 location-days, 1,610 positive. Not synthetic.
* **Trained:** dummy, published-threshold rule baseline, logistic regression, random forest, gradient boosting, with
  temporal + held-out-location splits, validation-chosen thresholds, SHAP.
* **Result (unseen locations, 2024):** best PR-AUC 0.051 vs prevalence 0.022; random forest (selected by validation)
  recall 0.056, precision 0.106, FPR 0.011. Better than the rule baseline on ranking, **not good enough for decisions**.
* **Use:** withheld by the evaluation gate (needs ≥ 3× prevalence PR-AUC and ≥ 0.5 recall). Registered in
  `model_versions` as `experimental`. The risk engine is rule-based. Full table: `docs/ML.md`.
* **Cyclone exposure (IBTrACS, 2026-11-23):** 46 years of NOAA best tracks on a 3,240-cell coastal grid
  (7.9 M place-weeks). Historical frequency is calibrated on unseen years 2018–2026 from 0.2 % to 6 % per week
  (ROC-AUC 0.935); gradient boosting does not beat it (Brier skill ≤ 0) and is withheld. Not yet used by the engine.
  Details: `docs/ML.md#cyclone-exposure-model-ibtracs`.

## 11. Test results (executed 2026-11-22)

| Suite | Result |
|---|---|
| Python `pytest` (risk-service) | **120 passed** — factors incl. threshold boundaries (67), aggregation/override/missing/stale/journeys/safer route/access (19), geometry/solar/parsers on real GDACS, USGS, Open-Meteo responses/HTTP retries/data quality (21), FastAPI + Postgres end-to-end with mocked providers incl. provider failures and alert dedup (7), ML features/no look-ahead/validation/metrics/gate (6) |
| Node `vitest` (server) | **74 passed** — profile, journeys, places, v1 auth, destinations, history, journey derivation/ownership/consent, incidents incl. RLS and transitions, alerts, client validation/timeouts, place mapping, FCM dispatch, LiteAPI client normalisation and errors, hotel routes (validation, ownership, cancellation, live-booking guard) |
| RLS SQL | `rls_test.sql` passed · `rls_risk_test.sql` passed |
| Live end-to-end (local, real providers) | Express → FastAPI → Postgres: `/api/places/conditions` for 10 places (Iceland HIGH — forecast 33 m/s gusts; New York MODERATE — 200 m fog; Bali MODERATE — thunderstorm; others LOW), journey assessment via OSRM (Iceland trek HIGH, personal + destination alert created), incident created |
| Frontend `vitest` | **139 passed** — includes the hotel services and an end-to-end booking workflow test (search → verify price → guests → confirm) |

## 12. Security

Supabase JWT (JWKS) or local dev tokens (refused in production); RLS on every table, enforced for the API's own
queries via `withUser`; Zod (Node) and Pydantic (Python) validation with unknown fields rejected; rate limits (300/min
global, 20/min assessments, 10/15 min incident creation, auth limiter); helmet, CORS allow-list, 256 KB body limit;
internal service bearer token compared in constant time, required in production and whenever the service is not on
loopback; risk-service responses schema-validated; errors never leak internals. Location: only with consent, only
attached to a journey, deleted after the traveller's retention period (daily purge); stored route geometry simplified to
~50 m. Secrets only in git-ignored `.env`; `.env.example` files contain placeholders. Public demo services (OSRM,
Overpass) receive coordinates — self-host for production.

## 13. Environment

`server/.env` — `DATABASE_URL`, `AUTH_MODE`, `LOCAL_JWT_SECRET` | `SUPABASE_URL`, `CORS_ORIGINS`, `RISK_SERVICE_URL`,
`RISK_SERVICE_TOKEN`, `RISK_SERVICE_TIMEOUT_MS`, `ASSESSMENT_MAX_AGE_MIN`, `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON`,
`LITEAPI_API_KEY`, `LITEAPI_ENV`, `LITEAPI_ALLOW_LIVE_BOOKINGS`, `LITEAPI_TIMEOUT_MS`.
`risk-service/.env` — `DATABASE_URL`, `RISK_SERVICE_TOKEN` (same value), `RISK_HOST`, `RISK_PORT`,
`RISK_SCHEDULER_ENABLED`, `RISK_HTTP_TIMEOUT_S`, optional `OSRM_DRIVING_URL`, `OSRM_FOOT_URL`, `OVERPASS_URLS`.
The risk data sources are keyless. Hotel booking needs a LiteAPI key (free sandbox key; see SETUP.md §6).

## 14. Deployment

1. Database: `cd server && DATABASE_URL=<supabase> npm run db:migrate` (no `--local`). PostGIS columns appear
   automatically on Supabase.
2. Risk service: Python 3.12 container/VM on a private subnet; `pip install -r requirements.txt`;
   `uvicorn app.main:app --host 0.0.0.0 --port 8001` behind a security group that only admits the API; set
   `RISK_ENV=production`, `RISK_SERVICE_TOKEN`; exactly one instance with `RISK_SCHEDULER_ENABLED=true`; run
   `python -m app.ingestion.load_history 10` once.
3. API: `npm ci && npm run build && npm start` with `NODE_ENV=production`, `AUTH_MODE=supabase`,
   `RISK_SERVICE_URL=http://<private-host>:8001`, same token.
4. Optional: self-hosted OSRM and Overpass; FCM credentials.
The repository has no AWS infrastructure definitions (only a GitHub Pages workflow for the frontend), so no AWS
resources were created; the steps above map directly onto ECS/Fargate or EC2 + RDS/Supabase.

## 15. Status, blockers and future work

| Item | Status |
|---|---|
| Eight factor modules, destination aggregation, critical override, explanations | Implemented |
| Journey context (4 dimensions), route exposure, safer route, travel-time weather | Implemented |
| Ingestion with retries, rate limiting, caching, fallbacks, freshness, duplicates, agreement | Implemented |
| Migration 0004, RLS, PostGIS-when-available | Implemented (PostGIS path not executed locally — no extension package) |
| Express `/api/v1`, incidents, alerts, devices; existing UI on the new engine | Implemented |
| APScheduler jobs | Implemented (enable in one instance) |
| Response accessibility | **External-dependent** — every public Overpass mirror timed out/504'd during testing, so live access results were "unknown" (handled as PARTIAL, never as safe); logic covered by tests; self-host Overpass |
| OSRM routing | External-dependent (demo server; fair use) |
| Hotel booking (LiteAPI) | **Credential-dependent** — client, routes, `hotel_bookings` table and the full booking UI are implemented and tested against documented response shapes; not yet run against the live sandbox (needs your key) |
| FCM push | **Credential-dependent** — sender + dispatcher implemented and unit-tested with a fake transport; not tested against Firebase |
| Supabase run | Credential-dependent — `server/.env` points at a Supabase project whose pooler rejected the connection; nothing was applied there. All verification used local Postgres |
| ML model | Trained on real data, evaluated, **withheld** by the gate (insufficient performance) |
| Frontend use of incidents/alerts APIs | Future — the emergency UI still uses localStorage; endpoints are ready |
| Visitor-number denominators, population density, historical GDACS polygons | Future (no free source integrated) |
| Calibrated probabilities | Future — requires labelled traveller-incident data |
