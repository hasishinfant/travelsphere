# TravelSphere

Trip planning with live travel-safety assessments and incident reporting.

Each destination is scored from eight measured factors (weather, active hazards, distance to hazards, route exposure,
time of travel, hazard history, population exposure and data reliability) using live data from Open-Meteo, GDACS and
USGS. Planned journeys get their own assessment based on the route, timing, activity and access to emergency care.

Hotels anywhere in the world can be searched and booked through [LiteAPI](https://docs.nuitee.com) (Nuitée). With a free
sandbox key, prices and availability are real and bookings are simulated — nothing is charged.

## Project structure

```
├── src/              React 19 + TypeScript frontend (Vite)
├── server/           Express API: auth, journeys, incidents, alerts, /api/v1
├── risk-service/     Python FastAPI service: data ingestion, risk engine, ML pipeline
├── supabase/         SQL migrations and Row Level Security tests
├── scripts/          Local development helpers
├── docs/             Setup, backend and ML documentation
└── public/           Static assets
```

## Running locally

Requirements: Node.js 20+, Python 3.12, PostgreSQL 15+, [uv](https://docs.astral.sh/uv/).

```bash
npm install
cd server && npm install && cp .env.example .env && cd ..   # set LOCAL_JWT_SECRET (openssl rand -hex 32)

npm run dev:backend    # terminal 1 — API on :4000 and risk service on :8001 (local Postgres)
npm run dev            # terminal 2 — app on http://localhost:3000
```

`dev:backend` creates the local database, applies the migrations, sets up the Python environment and loads the hazard
archive the first time it runs.

To enable hotel search and booking, create a free account at [connect.nuitee.com](https://connect.nuitee.com), copy the
sandbox key from *Developer tools* and set `LITEAPI_API_KEY` in `server/.env`.

## Tests

```bash
npm test                                         # frontend
cd server && npm test                            # API
cd risk-service && .venv/bin/python -m pytest    # risk engine
```

## Documentation

- [docs/SETUP.md](docs/SETUP.md) — configuration, Supabase, API reference
- [docs/BACKEND.md](docs/BACKEND.md) — architecture, risk methodology, endpoints, security, deployment
- [docs/ML.md](docs/ML.md) — hazard-event model: dataset, evaluation and results
- [risk-service/README.md](risk-service/README.md) — running and working on the risk service
