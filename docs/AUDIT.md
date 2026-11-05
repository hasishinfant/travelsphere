# TravelSphere — Repository Audit (Phase 1)

Date: 2026-11-04 · Branch: `main` · Base commit: `632c2a3`

This audit records what the repository contains today, measured against the
TravelSphere product specification (safety intelligence, incidents, journeys,
VR exploration). Its purpose is to make the starting point explicit before any
backend work begins.

---

## 1. Summary

| Area | State |
|---|---|
| Frontend (React 19 + TS + Vite 7) | Working single-page app. Redesigned UI (light theme, sidebar shell) is the baseline to preserve. |
| Backend | **None.** No Express server, no Python service, no `/api` routes exist. |
| Database / Auth | **None.** Login writes a JSON object to `localStorage`; any email/password is accepted. |
| Journeys / itineraries | Generated in the browser from a static catalogue (`src/data/destinations.ts`); stored in `localStorage`/`sessionStorage`. |
| Safety risk engine | **None.** The "confidence engine" scores destinations from mock data; it is not a risk model. |
| Weather / environment | **None.** No OpenWeatherMap integration. |
| Maps / geolocation | No Leaflet. No HTML5 Geolocation use. Destination map preview is a Google Maps embed. |
| Incidents | Emergency UI exists (4 categories, forms, ticket history, detail timeline) but is **localStorage-only** and **pre-seeded with demo tickets** shown as if they were the user's. |
| Admin | **None.** |
| Notifications | `public/sw.js` exists but is **not registered**. No Web Push / FCM. |
| VR / 3D | **None.** `VRModal` only embeds an iframe URL; no Three.js / WebXR. |
| ML | **None** in-repo. `codexService.ts` calls OpenAI directly from the browser (placeholder key, so every call returns 401 and falls back to mock data). |
| Tests | Vitest: 728 tests, **646 pass / 82 fail** (failures predate this work — see §7). |

---

## 2. Frontend structure

```
src/
  App.tsx                     routes; authenticated routes wrapped in AppShell
  components/
    layout/AppShell.*         sidebar (profile, Safety card + SOS, nav, regions), mobile top bar, drawer, tab bar
    ui/                       Photo, PageHeader, Segmented, TripCard, PlaceCard, MapModal, ProfileModal, ui.css
    trip-planner/             destination dropdown, dates, budget, interests, planner form
    itinerary/                DayCard, ItineraryTimeline
    hotel/                    TBO hotel search → results → details → guest form → pre-book → confirmation
    booking/                  BookingModal, combined flight+hotel workflow
    emergency/                landing, medical, passport, hotel complaint, local assistance, history, detail
    flight/                   flight segment display
    shared/                   Icon (Lucide), Button, LazyImage, loaders, error boundary, network status
    chat/                     DEAD CODE — chat UI no longer routed (spec §11.2); only referenced by tests
    destination/              legacy DestinationCard/Grid/VRModal (no longer used by Home)
  confidence-engine/          destination "confidence" badges + AIAssistantWidget (DEAD CODE, unrendered)
  data/destinations.ts        single source of truth: 10 destinations, verified photos, coordinates, places, food, tips
  services/                   27 service modules (see §4)
  styles/                     design tokens (variables.css), global primitives (global.css)
```

Routes: `/` (dashboard), `/plan-trip`, `/itinerary[/:tripId]`, `/book-hotels`,
`/emergency-support[/:tab | /requests/:id]`. `/chat/*` redirects to `/`.

### Design system (to preserve)
- Tokens in `src/styles/variables.css`: warm canvas `#f4f2ef`, white surfaces, ink `#1b1d2a`,
  single accent `#3d7bf7`, `--live` orange (SOS only), `--pro` violet (badges only), semantic success/warning/danger.
- Font: Outfit 400/500/600. Radii 8–32 px. Soft wide shadows. Pill buttons (`.btn-primary/-secondary/-ghost/-soft`).
- Icons: Lucide line icons only (emoji icons removed). Every location photo checked against its landmark.
- **No Tailwind.** The spec lists Tailwind CSS; the project uses plain CSS + tokens. Adding Tailwind would
  duplicate the design system and conflicts with §11 ("do not change styling"). Recommendation: keep CSS tokens.

---

## 3. Dependencies

Runtime: `react 19`, `react-dom 19`, `react-router-dom 7`, `@tanstack/react-query 5`, `axios`, `lucide-react`, `web-vitals`.
Dev: `vite 7`, `typescript 5.9`, `vitest 4`, `@testing-library/*`, `jsdom`, `msw`, `fast-check`, `gh-pages`, `terser`.

Not present but required by the spec: `leaflet`, `three`, `@supabase/supabase-js`, `express`,
`firebase` / Web Push, Python (`fastapi`, `scikit-learn`, `pandas`, `numpy`).

---

## 4. Services — real vs mocked

| Service | Talks to | Reality |
|---|---|---|
| `codexService` | OpenAI from the **browser** | Placeholder key → 401 → mock fallback. Must move server-side or be removed (no AI features per spec). |
| `itineraryService` / `mockDataService` | — | Generates itineraries locally from `data/destinations.ts`. |
| `hotelSearchService`, `hotelDetailsService`, `preBookService`, `hotelBookingService`, `bookingManagementService` | TBO Hotel API from the **browser** over `http://` | Fails (CORS / no credentials) → falls back to mock hotels, labelled "Demo mode". |
| `flightSearchService`, `fareRulesService`, `seatSelectionService`, `ancillaryService`, `repricingService`, `bookingService`, `combinedBookingService` | TekTravels (TBO Air) from the browser | Placeholder token → mock fallback. |
| `complaintService` | `localStorage` | Seeds `INITIAL_DEMO_RECORDS` (e.g. "TS-HTL-2026-7841") as the user's tickets — violates "no mock data as live data". |
| `emergencyService` | `/api/emergency-support` (doesn't exist) | Falls back via `require()` — **`require` is undefined in Vite's browser ESM build**, so the fallback path throws. |
| `confidence-engine/*` | `VITE_API_BASE_URL` (doesn't exist) | Mock scores. Not a risk model. |
| `tripStore` | `localStorage` | Normalises itineraries/bookings for the dashboard (new). |

---

## 5. Security findings

1. **Secrets in the frontend bundle (design flaw, no leak yet).** `.env` uses `VITE_OPENAI_API_KEY`,
   `VITE_TEK_TRAVELS_API_KEY`, `VITE_TBO_HOTEL_PASSWORD`. Vite inlines every `VITE_*` value into public JS.
   Today the values are placeholders, so nothing real has leaked (`dist/` contains the placeholder string;
   `dist/` is not committed; `.env` is git-ignored). **Any real key entered here would be published.**
   → All third-party credentials must move to the backend (Phase 2).
2. **No authentication.** Any email/password "logs in"; identity is a `localStorage` object.
3. **TBO hotel base URL is plain `http://`.**
4. **No server-side authorisation** anywhere (there is no server).

---

## 6. Gap analysis against the specification

| Spec module | Exists | Gap |
|---|---|---|
| 1 Auth & profiles | UI only (login screen, profile modal: name + home airport) | Supabase Auth, profiles table, preferences, privacy settings |
| 2 Journeys | Planner + itinerary UI, local storage | Persisted journeys/itinerary items, edit/cancel, API |
| 3 Geospatial | Coordinates per destination; map embed | Leaflet, geolocation with consent, risk zones, proximity |
| 4 Environment | — | OpenWeatherMap via backend, freshness/stale handling |
| 5 Safety intelligence | — | Validation → context → features → rule baseline → ML → explanation |
| 6 Early warning | — | Alerts, dedup/cooldown, acknowledgement, history |
| 7 Incidents | Rich UI (localStorage) | Persistence, statuses, history, location attach, SOS → incident |
| 8 Admin | — | Role-checked incident console, analytics |
| 9 VR | — | Three.js 360° viewer, WebXR, fallback, valid assets |
| 10 Feedback & evaluation | — | Feedback, false-alert review, model records |

Assets the spec needs that the repo does not have: **360° panoramas / 3D scenes** (licensed), **labelled
incident data** for training (none — prototype must use documented simulated scenarios), **risk-zone
geometry** (none — must be configured or sourced).

---

## 7. Test baseline

`npx vitest run` → 42 files, 728 tests: **646 pass, 82 fail** — identical before and after the UI redesign.
Pre-existing failure clusters (not caused by the redesign):
- `components/chat/*.test.tsx` import components that don't exist in that folder.
- Error-code tests expect `code` fields the error handler no longer sets (`BOOKING_FAILED`, `PREBOOK_FAILED`, …).
- Several hotel confirmation/guest-form tests assert markup that changed before this work.

---

## 8. Plan for Phase 2 (next)

Without credentials (none provided yet), Phase 2 is built so it runs locally and switches to Supabase when
keys are supplied:

1. `server/` — Express + TypeScript: `/api/profile`, `/api/journeys` CRUD, input validation, rate limiting,
   CORS, structured errors, auth middleware (Supabase JWT verification).
2. Storage adapter: **Supabase** when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are set; otherwise a
   clearly-labelled **local development store** (JSON file) so the app is usable offline. The API reports which
   store is active (`GET /api/health`), never pretending local data is production data.
3. `supabase/migrations/` — schema for all 12 tables in spec §10, constraints, indexes and RLS policies.
4. `.env.example` (placeholders only) for frontend and server; third-party keys removed from `VITE_*`.
5. Frontend: Vite dev proxy `/api → server`; journeys saved through the API (localStorage remains the
   offline cache).

Status vocabulary used in all later reports: *Fully implemented · Partially implemented ·
Requires external credentials or assets · Pending · Future scope.*

## 9. Production hardening (2026-11-05)

| Area | Finding | Fix |
|---|---|---|
| Crash | `supabaseClient.ts` threw at import when `VITE_SUPABASE_*` was unset; CI builds without them, so the GitHub Pages site rendered a blank page | Client is now optional (`isSupabaseConfigured`); app falls back to guest mode |
| Crash | `getSession()` rejection left the app on an infinite spinner | `.catch/.finally` always releases the loading state |
| Secrets | Demo account passwords shipped in the public bundle | Test-account panel is dev-only and tree-shaken from production |
| Secrets | Full source maps published to Pages | `sourcemap: false` for production builds |
| Secrets | Stale `VITE_OPENAI_API_KEY` typing invited putting a secret in a `VITE_` var | Removed; `vite-env.d.ts` documents that `VITE_*` is public |
| CI | No type check or secret scan before deploy | Workflow runs `tsc --noEmit` and greps `dist/` for key/DB-URL/JWT patterns |
| Crash logs | Production stripped *all* `console.*`, including errors | Only `log/info/debug/trace` stripped; new `utils/crashReporter.ts` keeps a redacted ring buffer (`window.__travelsphereCrashes()`) |
| Auth | Password-reset link pointed to a non-existent `/reset-password` outside the `/tbo/` base | Redirects to the app base URL |
| UX | No way in without Supabase | "Continue as guest" on the login page |
| Responsive | Fixed 320px trip cards overflowed narrow phones | `min(320px, 82vw)`; verified no horizontal overflow at 390px on all main routes |

**Database:** roles are stored in `profiles.role`, guarded by the `guard_profile_role` trigger and enforced by RLS; client-side `user_metadata.role` is display-only. Server secrets (`DATABASE_URL`, `LOCAL_JWT_SECRET`) live only in `server/.env` (gitignored, never committed — verified across full history).

**Enabling sign-in on Pages:** add repository *variables* `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Settings → Secrets and variables → Actions → Variables). Only the public anon key — never the service-role key.
