#!/usr/bin/env bash
# Start the TravelSphere backend for local development:
#   risk service (FastAPI) on :8001 and API (Express) on :4000, both on a LOCAL Postgres database.
# Usage:  npm run dev:backend            (then `npm run dev` in another terminal for the app on :3000)
# Override the database with  LOCAL_DATABASE_URL=postgres://... npm run dev:backend
# Your server/.env and risk-service/.env are not modified; DATABASE_URL is overridden for this run only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_URL="${LOCAL_DATABASE_URL:-postgres://localhost:5432/travelsphere_dev}"
DB_NAME="${DB_URL##*/}"

command -v pg_isready >/dev/null && pg_isready -q || { echo "PostgreSQL is not running (try: brew services start postgresql@16)"; exit 1; }
psql -d postgres -tAc "select 1 from pg_database where datname = '$DB_NAME'" | grep -q 1 || createdb "$DB_NAME"

echo "→ migrations on $DB_URL"
(cd "$ROOT/server" && DATABASE_URL="$DB_URL" npx tsx src/migrate.ts --local)

if [ ! -x "$ROOT/risk-service/.venv/bin/uvicorn" ]; then
  echo "→ creating Python environment for the risk service"
  (cd "$ROOT/risk-service" && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt)
fi

# One-off: historical hazard archive (skipped when already loaded)
if [ "$(psql "$DB_URL" -tAc "select count(*) from public.hazard_events where source_id = 'gdacs' and not is_current")" -lt 100 ]; then
  echo "→ loading the GDACS hazard archive (one-off, ~1 min)"
  (cd "$ROOT/risk-service" && DATABASE_URL="$DB_URL" .venv/bin/python -m app.ingestion.load_history 10)
fi

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "→ risk service on http://127.0.0.1:8001"
(cd "$ROOT/risk-service" && DATABASE_URL="$DB_URL" RISK_HOST=127.0.0.1 \
  .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001 --log-level warning) &

echo "→ API on http://127.0.0.1:4000"
(cd "$ROOT/server" && DATABASE_URL="$DB_URL" npm run dev) &

wait
