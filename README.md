# TravelSphere

Journey planning, travel safety information and incident reporting.

- **Frontend** — React 19, TypeScript, Vite (`src/`)
- **API** — Node.js, Express, PostgreSQL / Supabase (`server/`, `supabase/`)

## Quick start

```bash
npm install && cp .env.example .env
cd server && npm install && cp .env.example .env   # set LOCAL_JWT_SECRET
createdb travelsphere_dev && npm run db:migrate -- --local
npm run dev                                        # API on :4000
cd .. && npm run dev                               # app on :3000
```

## Documentation

- [docs/SETUP.md](docs/SETUP.md) — setup, tests, API reference, Supabase migration, implementation status
- [docs/AUDIT.md](docs/AUDIT.md) — repository audit and gap analysis
- [docs/COMBINED_BOOKING.md](docs/COMBINED_BOOKING.md) — combined flight + hotel booking flow
