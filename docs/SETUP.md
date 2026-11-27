# TravelSphere — Setup and API

## 1. Prerequisites
- Node.js 20+
- Python 3.12 and [uv](https://docs.astral.sh/uv/) (risk service)
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
npm run dev:backend             # API on :4000 + risk service on :8001, against local Postgres
npm run dev                     # app on http://localhost:3000, proxies /api → :4000
```

If the API is not running, sign-in still works but the session is **offline**: trips stay on that device
and the sidebar shows "On this device only".

### Risk-intelligence service (Python)

See `risk-service/README.md`. Without it, `/api/places/*` falls back to the labelled `rules-v1` engine and
`/api/v1/*` assessment endpoints return 503 (never a "safe" result).

## 4. Tests

```bash
npm test                                   # frontend (Vitest)
cd server && npm test                      # API integration tests against a throwaway Postgres database
psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/rls_test.sql        # Row Level Security acceptance tests
psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/rls_risk_test.sql   # RLS for the risk-intelligence tables
cd risk-service && .venv/bin/python -m pytest -q                      # risk engine (creates travelsphere_risk_test)
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

## 6. Hotel booking (LiteAPI)

1. Create a free account at https://connect.nuitee.com and copy the **sandbox** key from *Developer tools*.
2. In `server/.env`: `LITEAPI_API_KEY=<sandbox key>` (leave `LITEAPI_ENV=sandbox`). Restart the API.
3. `GET /api/v1/hotels/status` should report `configured: true`.

Sandbox searches return real hotels and prices; bookings are simulated and nothing is charged. A production key bills the
LiteAPI account, so live bookings stay disabled unless `LITEAPI_ENV=production` **and**
`LITEAPI_ALLOW_LIVE_BOOKINGS=true` are both set. In sandbox mode the server also checks the key itself: prebook and
book are refused (403 `live_booking_disabled`) unless the key is a sandbox key (`sand_…`), so a production key left in a
sandbox configuration cannot create a billed reservation. The key is only ever used by the server.

Search results include a map (Leaflet with OpenStreetMap tiles, no key needed) with a price pin per hotel; hovering
a card highlights its pin, and a pin's popup opens the hotel. Pins that would overlap merge into a cluster pin
("6 hotels · from €146"); clicking it zooms in until they separate, and hotels at the same address open as a list. OpenStreetMap's public tiles are meant for light use —
for real traffic switch the tile URL in `src/components/hotel/HotelMap.tsx` to a tile provider.

## 7. API

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

### Risk intelligence (`/api/v1`)

The versioned API and the eight-factor engine (`scoring-v2`) are documented in
[BACKEND.md](BACKEND.md). `/api/places/*` keeps its response shape but is now computed by
that engine; the section below describes the earlier rule baseline, which remains as the fallback.

### 8-factor safety assessment (rule baseline `rules-v1`, fallback)

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

Project status and known limitations are tracked in [BACKEND.md](BACKEND.md#15-status-blockers-and-future-work).
