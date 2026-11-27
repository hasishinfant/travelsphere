# TravelSphere risk-intelligence service

Python 3.12 · FastAPI · Pydantic v2 · SQLAlchemy 2 · Pandas/NumPy · GeoPandas/Shapely/PyProj · scikit-learn/SHAP · APScheduler

Computes the eight-factor destination and journey-context safety assessments for the Express API. It is an
**internal** service: bind it to loopback or a private network and let only Express call it (shared bearer token).

## Run

```bash
cd risk-service
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
cp .env.example .env                     # set DATABASE_URL (same DB as the API) and RISK_SERVICE_TOKEN
set -a; . ./.env; set +a
.venv/bin/python -m app.ingestion.load_history 10      # one-off: GDACS Orange/Red archive for historical risk
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001
```

The schema is created by the SQL migrations (`cd server && npm run db:migrate`), never by this service.

## Layout

```
app/
  main.py                 FastAPI app, error handlers, lifespan (scheduler)
  api/routes.py           /health (public), /internal/v1/* (token)
  core/                   settings, internal auth
  schemas/                FactorResult contract, domain objects, request models
  ingestion/              http (timeouts/retries/rate limit/cache), open_meteo, gdacs, usgs, osrm, overpass, load_history
  processing/             data quality: credibility, freshness, duplicates, cross-source agreement
  geospatial/             geodesic + AEQD geometry, route overlay (GeoPandas), NOAA solar position
  risk_engine/
    factors/              one module per factor (8)
    aggregation/          versioned scoring config, destination aggregation, critical override
    journey_context/      four-dimension journey assessment, response accessibility
    explanations/         explanation builder (from computed inputs only)
    context.py            AssessmentContext + "affecting hazard" rule
  services/               orchestration: data acquisition with fallbacks, destination, journey, alerts
  database/               SQLAlchemy engine + repository (bound parameters only)
  background/scheduler.py APScheduler jobs
  ml/                     dataset builder, validation, features, training, evaluation, inference (see docs/ML.md)
  config/scoring-v2.json  scoring configuration (versioned; see docs/RISK_MODEL.md)
tests/                    pytest (factors, aggregation, journeys, geometry, parsers on real responses, API + DB, ML)
```

## Test

```bash
.venv/bin/python -m pytest -q          # needs a local PostgreSQL for the API/DB tests (creates travelsphere_risk_test)
```

## Internal API

| Method | Path | Body |
|---|---|---|
| GET | `/health` | — |
| GET | `/internal/v1/status` | — scoring config, PostGIS, provider health, ML model status |
| POST | `/internal/v1/assessments/destination` | `{destination_id, persist?}` |
| POST | `/internal/v1/assessments/destinations` | — all active destinations |
| POST | `/internal/v1/assessments/journey` | `{user_id, journey_id?, destination_id, origin?, current_location?, waypoints[], travel_start, travel_end?, activity, activity_duration_minutes?, travellers, transport_mode}` |
