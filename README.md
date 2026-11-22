# TravelSphere

Journey planning, travel safety information and incident reporting.

- **Frontend** — React 19, TypeScript, Vite (`src/`)
- **API** — Node.js, Express, PostgreSQL / Supabase (`server/`, `supabase/`)
- **Risk intelligence** — Python, FastAPI, GeoPandas, scikit-learn (`risk-service/`, internal only)

## Quick start

```bash
npm install && cp .env.example .env
cd server && npm install && cp .env.example .env   # set LOCAL_JWT_SECRET
createdb travelsphere_dev && npm run db:migrate -- --local
npm run dev                                        # API on :4000
cd ../risk-service && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
cp .env.example .env && set -a && . ./.env && set +a   # same DATABASE_URL; RISK_SERVICE_TOKEN = server's
.venv/bin/python -m app.ingestion.load_history 10      # one-off hazard archive
.venv/bin/uvicorn app.main:app --port 8001             # risk service on :8001
cd .. && npm run dev                               # app on :3000
```

## Documentation

- [docs/SETUP.md](docs/SETUP.md) — setup, tests, API reference, Supabase migration, implementation status
- [docs/BACKEND_IMPLEMENTATION.md](docs/BACKEND_IMPLEMENTATION.md) — risk engine, APIs, methodology, test results, status
- [docs/BACKEND_REPOSITORY_AUDIT.md](docs/BACKEND_REPOSITORY_AUDIT.md) — backend audit before the risk-intelligence work
- [risk-service/app/ml/README.md](risk-service/app/ml/README.md) — ML experiment and actual results
- [docs/AUDIT.md](docs/AUDIT.md) — repository audit and gap analysis
- [docs/COMBINED_BOOKING.md](docs/COMBINED_BOOKING.md) — combined flight + hotel booking flow
