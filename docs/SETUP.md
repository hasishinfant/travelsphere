# TravelSphere — Local Setup, API and Status

## 1. Prerequisites
- Node.js 20+ (developed on 26)
- PostgreSQL 15+ running locally (or a Supabase project)

## 2. First-time setup

```bash
# Frontend
npm install
cp .env.example .env            # placeholders only; no secrets belong in VITE_ variables

# API server
cd server
npm install
cp .env.example .env            # then set LOCAL_JWT_SECRET to 32+ random characters:
                                #   openssl rand -hex 32
createdb travelsphere_dev
npm run db:migrate -- --local   # --local adds the auth shim a plain Postgres needs (never use on Supabase)
```

## 3. Run

```bash
cd server && npm run dev        # API on http://127.0.0.1:4000
npm run dev                     # (repo root) app on http://127.0.0.1:3000, proxies /api → :4000
```

If the API is not running, sign-in still works but the session is **offline**: trips stay on that device
and the sidebar shows "On this device only".

## 4. Tests

```bash
npm test                                   # frontend (Vitest) — baseline 646 pass / 82 pre-existing failures
cd server && npm test                      # API integration tests against a throwaway Postgres database
psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/rls_test.sql   # Row Level Security acceptance tests
```

`server` tests create and drop `travelsphere_api_test`; set `TEST_ADMIN_DATABASE_URL` if Postgres is not at
`postgres://localhost:5432/postgres`.

## 5. Moving to Supabase (when credentials exist)

1. Run the migrations on the Supabase database: `DATABASE_URL=<supabase connection string> npm run db:migrate`
   (without `--local` — Supabase already provides `auth.users`, `auth.uid()` and the roles).
2. Server `.env`: `AUTH_MODE=supabase`, `SUPABASE_URL=…` (JWKS verification), `DATABASE_URL=<supabase>`.
3. Frontend `.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; replace the dev-session call in
   `LoginPage` with `supabase.auth.signInWithPassword` and pass the access token to the API. *(Pending.)*

`AUTH_MODE=local` is refused when `NODE_ENV=production`.

## 6. API (Phase 2)

All responses are JSON. Errors: `{ "error": { "code", "message", "details?" } }`.
Authenticated routes need `Authorization: Bearer <token>`. Every query runs as the `authenticated`
database role with the caller's id, so Row Level Security applies in addition to route checks.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{ status, version, auth_mode, database }` — 503 if the DB is down |
| POST | `/api/auth/dev-session` | **Local mode only.** `{ email, full_name? }` → `{ token, user }`. Rate-limited (20 / 15 min). |
| GET | `/api/profile` | Current traveller profile |
| PUT | `/api/profile` | `full_name`, `home_airport` (IATA), `home_city`, `location_consent`, `location_retention_days`. `role` is rejected. |
| GET / PUT | `/api/profile/preferences` | `in_app`, `web_push`, `min_risk_level` (merged) |
| GET | `/api/journeys?status=` | Own journeys with `item_count` |
| POST | `/api/journeys` | Journey + `items[]` (validated dates, coordinates, enums; unknown fields rejected) |
| GET | `/api/journeys/:id` | Journey with itinerary items; 404 for other users' journeys |
| PUT | `/api/journeys/:id` | Partial update; `status` (`planned/active/completed/cancelled`); `items` replaces the list |
| DELETE | `/api/journeys/:id` | Hard delete (cancellation is `PUT { status: "cancelled" }`) |
| GET | `/api/places/conditions` | Safety meter for every place: risk level, factors backed by data (n/8), headline, weather |
| GET | `/api/places/:id/assessment` | Full 8-factor assessment (value, source, explanation per factor), recommended action, freshness, model version. Recorded in `risk_assessments` (deduplicated for 15 min). |

### 8-factor safety assessment (rule baseline `rules-v1`)

Factors: hazard intensity, tourist exposure, location risk, time context, weather & environment,
accessibility & remoteness, historical incidents, journey context. Each is 0–1 with a provenance:
*live* (Open-Meteo, database), *derived* (your journey), *configured* (place setting/terrain, risk zones),
*default* (generic assumption) or *unavailable*. **Confidence = number of factors backed by live, derived or
configured data** — not a probability. Thresholds come from published definitions (AMS heavy rain 7.6 mm/h,
Beaufort gale 17.2 m/s, WMO thunderstorm codes, fog < 1 km). No weather → no risk level is given.
CRITICAL is reserved for official warnings (not integrated). Weather comes from Open-Meteo (keyless);
OpenWeatherMap can replace it when a key is available. Code: `server/src/services/riskEngine.ts`.

### 360° viewer

`/places/:id` → *View in 360°*: Three.js equirectangular viewer (drag, zoom, phone motion) with **Enter VR** on
WebXR-capable browsers/headsets. Panoramas are openly licensed Wikimedia Commons photos, checked by eye, with
attribution in the viewer (`src/data/panoramas.ts`). They are recorded photos, not live feeds. Bali has no verified
panorama yet.

General rate limit: 300 requests/min per IP. Body limit 256 KB. Helmet security headers. CORS restricted
to `CORS_ORIGINS`.

## 7. Implementation status (after Phase 2)

| Item | Status |
|---|---|
| UI redesign baseline; assistant/chatbot UI, AI wording and AI metadata removed | Fully implemented |
| Browser-side OpenAI calls removed (no secrets in the bundle path) | Fully implemented |
| Database schema — all 12 spec tables, constraints, indexes | Fully implemented (tested on Postgres 16) |
| Row Level Security policies | Fully implemented (SQL acceptance tests + a mutation check) |
| Express API: health, profile, preferences, journeys CRUD, validation, rate limiting | Fully implemented (16 integration tests) |
| Frontend ↔ API: sign-in session, journeys saved/loaded/cancelled across devices, profile save | Fully implemented (browser end-to-end test) |
| Supabase Auth (real passwords, email verification) | Requires external credentials |
| TBO hotel/flight calls proxied through the server (credentials still `VITE_`-based) | Pending |
| Incidents persisted via API (UI still uses localStorage + seeded demo tickets) | Pending — Phase 5 |
| Live weather (Open-Meteo, validated, stored, stale-aware) | Fully implemented (OpenWeatherMap swap requires a key) |
| 8-factor rule baseline, explanations, recommended actions, safety meters, place page | Fully implemented (17 engine + 7 API tests, browser test) |
| Risk zones | Partially implemented — schema, RLS and engine support; no zones configured yet, no admin UI |
| 360° viewer + WebXR | Fully implemented for 9 of 10 places (VR verified only for feature detection — no headset tested) |
| Geolocation, Leaflet maps | Pending — Phase 3 |
| ML model (scikit-learn), FastAPI service, rule-vs-ML evaluation | Pending — Phase 4 (no labelled data; simulated scenarios will be documented) |
| Warnings, Web Push/FCM, admin console | Pending — Phase 5 (FCM requires a Firebase project) |
| 360° / WebXR viewer | Pending — Phase 6 (requires licensed panoramic assets) |
| AWS deployment | Pending — Phase 7 |
