# TravelSphere — Backend Repository Audit

Date: 2026-11-22 · Branch `main` · Base commit `53d43a7`

This audit records the backend as it stood **before** the risk-intelligence work, and the decisions taken
because of it. The earlier product-wide audit is `docs/AUDIT.md`; this document only covers the backend.

## 1. Existing architecture

```
React 19 + Vite SPA (src/)  ──/api──▶  Express 5 + TypeScript (server/)  ──pg──▶  PostgreSQL 16 / Supabase
                                         │
                                         └──▶ Open-Meteo forecast (keyless)
```

* **No Python service** existed. No FastAPI, scikit-learn, pandas, geospatial libraries or ML artefacts.
* **Express API** (`server/src`): `app.ts` wires helmet, CORS allow-list, JSON body limit (256 KB), express-rate-limit
  (300/min per IP, 20/15 min on sign-in), structured JSON errors (`http.ts`), Zod validation.
* **Auth** (`auth.ts`): `AUTH_MODE=local` (HS256 dev tokens, refused in production) or `AUTH_MODE=supabase`
  (JWKS / legacy secret). Every user query runs inside `withUser()` which sets `role authenticated` and the JWT
  `sub`, so Row Level Security applies to the backend's own queries.
* **Migrations**: plain SQL in `supabase/migrations`, applied in filename order by `server/src/migrate.ts`, tracked in
  `public.schema_migrations`. `supabase/local/00_auth_shim.sql` recreates `auth.users`/`auth.uid()`/roles for a plain
  Postgres.

## 2. Existing implementation

| Area | Files | State |
|---|---|---|
| Health | `app.ts` | `GET /api/health` with DB check |
| Profile & preferences | `routes/profile.ts` | Working, tested |
| Journeys + itinerary items | `routes/journeys.ts` | Full CRUD, RLS, tested |
| Place safety | `routes/places.ts`, `services/riskEngine.ts` | 8-factor **rule baseline `rules-v1`** in TypeScript |
| Weather | `services/weather.ts` | Open-Meteo current + 6 h, validated, stored, stale-aware |
| Incidents | schema + RLS only | **No API**; frontend `complaintService.ts` is localStorage-only |
| Alerts / notifications | schema only | No generation, no delivery |
| Model registry | `model_versions` with `rules-v1` | No ML model |

### Existing risk-engine logic (`rules-v1`)
Eight factors: hazard intensity, tourist exposure, location risk, time context, weather & environment,
accessibility & remoteness, historical incidents, journey context. Weather thresholds come from published
definitions (AMS rain rate, Beaufort, WMO codes). Weaknesses relative to the new specification:

1. Two factors (hazard intensity, weather & environment) are both weather; there is **no real hazard feed**
   (floods, cyclones, earthquakes, wildfires).
2. "Location risk", "accessibility & remoteness" and part of "journey context" come from **hand-configured**
   place attributes (`server/src/data/places.ts`: setting, terrain) — editorial, not measured.
3. Historical incidents = `count/10` of TravelSphere's own (empty) incident table.
4. No geometry: distances are haversine to circle-shaped `risk_zones` (none configured); no route analysis.
5. Destination and journey assessment are mixed in one function; one row type (`risk_assessments`).
6. Data reliability is a count of "available" factors, not a quality measurement.

These are not bugs — they were documented as a prototype baseline — but they are the gap this work closes.

## 3. Existing database tables (migrations 0001–0003)

`profiles`, `journeys`, `itinerary_items`, `risk_zones`, `environment_observations`, `model_versions`,
`risk_assessments`, `incidents`, `incident_updates`, `notifications`, `device_tokens`, `feedback`,
`schema_migrations`. All have RLS enabled. Roles: `traveller`, `responder`, `admin` in `profiles.role`
(guarded by trigger). No PostGIS (the local Postgres 16 has no PostGIS package; Supabase has it).

## 4. Existing external integrations

| Integration | Where | Notes |
|---|---|---|
| Open-Meteo forecast | server | Keyless; only integration actually used |
| TBO Hotel / TekTravels Air | browser (`src/services`) | Credentials still `VITE_*`; falls back to mock data — out of scope here |
| Supabase Auth | browser + server | Optional; local dev auth otherwise |
| OpenWeatherMap, FCM | `.env.example` placeholders only | Not implemented |

## 5. Datasets and model artefacts

None in the repository. There is **no labelled incident dataset**. The `incidents` table is empty in development.

Reachable public sources (verified 2026-11-22, all keyless):

| Source | Use | Verified |
|---|---|---|
| Open-Meteo forecast | weather severity | 200 |
| Open-Meteo archive (ERA5) | historical weather → ML features | 200 |
| Open-Meteo geocoding (GeoNames) | locality population, timezone | 200 |
| GDACS event API (JRC/UN) | active + historical floods, cyclones, earthquakes, wildfires, volcanoes, droughts, with alert levels | 200 (paged, 100/page) |
| USGS earthquake feeds / FDSN | active + historical earthquakes | 200 |
| OSRM public demo server | route geometry, alternatives | 200 (demo server: no SLA, fair use) |
| Overpass API (OpenStreetMap) | hospitals / police / fire stations | **502 at capacity during audit** — needs retry, mirror, caching |
| NASA EONET | natural events | 200 (not used: overlaps GDACS) |

GDACS historical events (Orange/Red flood + tropical cyclone, 2022–2024: 123 events) combined with ERA5 daily weather
give a **real, independently-labelled** dataset for a hazard-event classifier. That is the ML experiment pursued here;
it is not a traveller-accident model (no such labels exist).

## 6. Incomplete or mocked functionality (backend-relevant)

* Incidents, alerts, notifications: schema only.
* Risk zones: schema only; none configured.
* Place profiles hard-coded in TypeScript (no `destinations` table).
* `complaintService.ts` seeds demo tickets in the browser (frontend; not changed by this work).

## 7. Required migrations

`0004_risk_intelligence.sql`:
`destinations` (seeded from the existing place profiles), `data_sources`, `hazard_events`, `safety_indicators`,
`destination_assessments`, `factor_assessments`, `journey_locations`, `journey_assessments`, `safety_alerts`,
`assessment_history`, `emergency_facilities`; extend `model_versions` and `incidents`; RLS for all; PostGIS enabled
**when the extension is available** (geography columns + GiST indexes), otherwise lat/lng + B-tree indexes.

**Migration ownership:** the existing SQL migration runner stays the single owner of the schema. Alembic is **not**
introduced: two migration systems writing to one schema would conflict. Python uses SQLAlchemy 2.x for access only.

## 8. Security concerns

1. Python service must not be public: shared-secret bearer (`RISK_SERVICE_TOKEN`, constant-time compare), bind to
   127.0.0.1 by default, only Express calls it.
2. Location data: journey locations get an `expires_at` from the profile's `location_retention_days`; a purge job
   deletes expired rows. Coordinates in assessments are rounded to ~100 m except for route geometry the user owns.
3. Incidents: reporters can only create `open` incidents and read their own; status changes are staff-only (RLS + route).
4. `server/.env` exists locally (git-ignored, never committed — verified). New secrets go in `.env` files only.
5. Public demo services (OSRM, Overpass) receive coordinates. Documented; self-hosting recommended for production.

## 9. Recommended implementation sequence (followed)

1. Migration 0004 + seeds; keep 0001–0003 untouched.
2. Python service skeleton: config, internal auth, HTTP client (timeouts, retries, rate limit, cache), DB layer.
3. Ingestion: Open-Meteo, GDACS, USGS, OSRM, Overpass, geocoding; data-quality module.
4. Eight factor modules, each independent with its own tests.
5. Destination aggregation (versioned config) + critical override + explanations.
6. Journey context (4 dimensions), route exposure, safer-route comparison, response accessibility.
7. ML: dataset builder (GDACS × ERA5), leakage-safe split, baselines, RF/GB, SHAP, honest report.
8. Express `/api/v1` routes, risk-service client, incidents, alerts; existing `/api/places` re-pointed at the new
   engine with the old rule engine as a labelled fallback, so the current UI keeps working unchanged.
9. Scheduler, tests (pytest + vitest/supertest), docs.
