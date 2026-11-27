# Emergency system implementation report

Date: 2026-11-25. Base commit `26d4722`. The audit that preceded this work is
[EMERGENCY_SYSTEM_AUDIT.md](EMERGENCY_SYSTEM_AUDIT.md).

**What TravelSphere now does in an emergency, in one paragraph.** It shows the local emergency numbers, taken from
official sources, with the source shown beside them. It can **register** an incident (SOS, medical, lost documents,
local help) on TravelSphere's server and tells the traveller whether that worked. Responder accounts can see the
incident and change its status, and the traveller sees only statuses a responder actually set. It lists nearby
hospitals, clinics, police and fire stations from OpenStreetMap. It does **not** contact police, ambulances, hospitals,
embassies or hotels, and the app says so wherever this could be misunderstood.

The five things the app keeps separate:

| Event | Meaning in TravelSphere | How it is shown |
|---|---|---|
| Incident registration | The server stored the incident and returned a reference (`INC-…`). | "Incident registered", shown only after the server answers 200/201. |
| Contact notification | A push to a responder or the reporter was **accepted by FCM** (`delivery_status = 'sent'`). Not shown to travellers as delivery. | Responders get an in-app alert; push only when FCM is configured. The SMS hand-off says "You send it yourself". |
| Emergency calling | The phone's dialler opened with a `tel:` link. | "TravelSphere can't tell whether the call connected." |
| Responder acknowledgement | A responder set the status to `acknowledged` (or later). | "A TravelSphere responder has acknowledged it." |
| Actual dispatch | Not available. TravelSphere has no channel to emergency services. | "TravelSphere does not contact police, ambulance or hospitals for you." |

## 1. What was implemented

- **Truthful wording everywhere.** Removed the invented hotline, the "15-minute response", coordinator, concierge,
  liaison and "Live Channel" claims, the 1.2 s fake sending delay, simulated replies, "24/7" badges, pre-filled fake
  phone and insurer values, and the seeded demo tickets (and their copies already in browsers).
- **SOS registers a real incident.** Confirm → location (up to 10 s, with "Send without location") → "Creating
  incident…" → "Incident registered" with reference, status, who can see it and whether the location was included.
  Or "Not registered", with the reason and the call panel. Retries and double taps reuse one `client_request_id`, so
  the server never creates two incidents. "Try adding my location" attaches GPS later.
- **Medical, lost-document and local-help forms create server incidents** with validated, structured details. Form
  data is kept on failure; "Try again" is idempotent.
- **Hotel complaints stay on the device** and say so. There is no channel to hotels, so none is claimed.
- **Nearby facilities** from OpenStreetMap: hospitals, clinics, police, fire stations, with distance, phone (only when
  mapped), emergency-department status (only when tagged), directions and map-record links, source, licence and
  retrieval date. Includes loading, failed, empty, location-denied, retry and wider-search states.
- **Emergency numbers by country**, bundled with the app (works without the server). Each number shows its official
  source and check date. The country comes from GPS through a server lookup, or from a manual choice, and the last
  country is remembered.
- **Incident pages** for travellers (status, history, notes, add location; refreshes every 30 s). A minimal
  **responder console** (`/emergency-support/responder`) lists all incidents by status. Responders can apply only the
  backend's allowed transitions, assign to themselves, verify, and add notes.
- **Responder alerts.** A new SOS or urgent medical incident queues an in-app `incident_alert` for every responder
  account. The push dispatcher now also delivers incident alerts and updates, and records delivery errors.
- **Privacy.** Precise locations of finished incidents are coarsened to ~1 km after 30 days. Facility lookups send a
  rounded position to OpenStreetMap. Coordinates travel in request bodies and never in push payloads.

## 2. Existing functionality reused

- `server/src/routes/v1/incidents.ts`: schema, RLS-backed access, transition table, reporter notifications, notes.
  It was extended, not replaced.
- `server/src/integrations/fcm.ts`: the FCM sender and dispatcher (extended to incident kinds).
- `server/src/routes/v1/alerts.ts`: device-token register/delete, unchanged.
- `risk-service/app/ingestion/overpass.py` with the `emergency_facilities` / `facility_searches` cache.
- `src/services/apiClient.ts` (`api`, `ensureSession`, `ApiError`), and the existing emergency CSS classes and form
  layouts. No screens outside Emergency were redesigned. The login page lost one phrase ("24/7 help").

## 3. Frontend changes

| File | Change |
|---|---|
| `src/services/emergency.ts` (new) | Geolocation helper with failure reasons; `registerIncident` (offline/session checks, failure classification); incident, location, note, status and role calls; status and responder wording; nearby and country lookups; remembered country. |
| `src/data/emergencyNumbers.ts` (new) | Sourced emergency-number table (§8). |
| `EmergencyCallPanel.tsx` (new) | Numbers for the country, verification badge, source link, manual country choice, honest dialler note. |
| `IncidentOutcome.tsx` (new) | Shared "Incident registered" and "Not registered" panels. |
| `NearbyResources.tsx` (new) | OpenStreetMap facilities list with all states. |
| `IncidentDetailView.tsx`, `IncidentList.tsx`, `ResponderConsole.tsx` (new) | Server incident pages, lists and responder controls. |
| `SOSButton.tsx` | Rewritten around the server (see §1). The SMS hand-off is now optional, under "Text someone you trust". |
| `MedicalEmergencyView`, `LostPassportView`, `LocalAssistanceView` | Submit to the server; honest copy; no fake defaults; phone format matches the server; no `alert()`. |
| `EmergencyLandingView` | Call panel instead of chips and hotline; nearby facilities; "Your incidents" from the server; device-only list; "what this service does and doesn't do"; responder console link for staff. |
| `HotelComplaintView`, `ComplaintHistoryView`, `ComplaintDetailView`, `complaintService.ts` | Device-only wording; no demo seeding; old demo tickets removed; no simulated replies; notes and status are the traveller's own. Medical/passport/local local-storage submitters removed. |
| `EmergencyPage.tsx` | UUID requests → server incident page; `responder` tab; incidents section above device-only history. |
| `AppShell.tsx`, `LoginPage.tsx` | Removed "24/7". |
| Removed | `EmergencyDashboard.tsx`, `EmergencyButton.tsx`: never rendered, and they contained false promises. |

## 4. Backend changes

- `server/src/routes/v1/incidents.ts`:
  - New categories `lost_documents` and `assistance`; per-category strict `details` schemas.
  - `client_request_id` idempotency: a repeat returns `200` with `duplicate: true`.
  - Default priority: SOS → critical, medical with urgency "immediate" → high.
  - The response includes `responder_accounts`.
  - Responder alerts for critical or high incidents, with no coordinates in the text.
  - `POST /:id/location` (reporter only, active incidents only, audited as an update).
  - Updates carry `by_responder`; assignment only to responder accounts.
  - Separate SOS rate limit, so ordinary reports can't exhaust it; write limits on location, status and notes.
- `server/src/routes/v1/emergency.ts` (new): `POST /resources`, `POST /country`, `GET /capabilities`.
- `server/src/integrations/riskService.ts`: `facilitiesNear` (60 s, longer than the risk service's 45 s Overpass
  deadline) and `countryAt`.
- `server/src/integrations/fcm.ts`: dispatches `incident_alert` and `incident_update` to users with a registered
  device, alerts first; records `delivery_error` and `delivery_attempted_at`. Without a sender nothing is marked sent.
- `server/src/index.ts`: hourly location-retention job. `/api/health` reports `push: configured|not_configured`.
- `risk-service`:
  - `app/geospatial/countries.py` (new): point → ISO country from Natural Earth admin-0.
  - `overpass.py`: keeps `phone` / `contact:phone` / `emergency:phone` as mapped, plus `healthcare`.
  - `data.nearby_facilities`: rounded query, true distances, radius cut, explicit `error`.
  - `repository.py`: stores phone and healthcare; stores the rounded search centre, never the exact position.
  - `routes.py`: `POST /internal/v1/facilities` and `/internal/v1/country`.

## 5. Database changes and migrations

`supabase/migrations/0006_emergency.sql`:

- `incidents`:
  - Category check extended with `lost_documents` and `assistance`.
  - `details jsonb` (object, ≤ 8 KB).
  - `client_request_id uuid`, with a unique index on `(reporter_id, client_request_id)`.
  - `location_coarsened_at`.
  - Function `coarsen_incident_locations(interval default '30 days')` (execute revoked from `public`).
- `notifications`: kind `incident_alert`; `delivery_error`, `delivery_attempted_at`.
- `emergency_facilities`: `phone`, `healthcare`. `facility_searches` is emptied so cached areas refetch with phone numbers.
- RLS is unchanged. Travellers still cannot update incidents, so the location endpoint checks ownership under RLS and
  then writes with the server's connection, the same pattern as the existing reporter notifications.

**Applied to:** the throwaway test database (every server test run) and local `travelsphere_dev`. **Not applied** to
the Supabase project. One attempt ran through `server/.env`, whose `DATABASE_URL` points at the Supabase pooler; it
failed to connect ("tenant/user not found"), so nothing was written. Apply it with `npm run db:migrate` (in `server/`)
when you choose to.

## 6. API endpoints

All require a bearer token.

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /api/v1/incidents` | Register an incident | Body adds `details`, `client_request_id`. 201 new, 200 duplicate. Returns `{ incident, duplicate, responder_accounts }`. SOS: 6 per 15 min; others: 10 per 15 min. |
| `GET /api/v1/incidents?scope=mine\|all&status=` | List | `all` is responders/admins only (403). |
| `GET /api/v1/incidents/:id` | Incident with `updates[].by_responder` | 404 for others' incidents. |
| `POST /api/v1/incidents/:id/location` | Reporter adds or corrects GPS | 404 not yours; 409 if resolved or closed. |
| `PATCH /api/v1/incidents/:id/status` | Responder status, verification, assignment | 403 travellers; 409 invalid transition; 400 assigning a non-responder. |
| `POST /api/v1/incidents/:id/notes` | Note | Reporter or staff. |
| `POST /api/v1/emergency/resources` | Nearby facilities `{ latitude, longitude, radius_m ∈ 2000/5000/10000/25000 }` | 10 per minute. `error` set when OpenStreetMap failed. |
| `POST /api/v1/emergency/country` | `{ country_code }` or `null` | |
| `GET /api/v1/emergency/capabilities` | What this deployment can do | Includes responder account count, push, SMS (`not_configured`), dispatch (`not_available`). |

## 7. Notification configuration requirements

- **Server push (FCM):**
  - Set `FCM_PROJECT_ID` and `FCM_SERVICE_ACCOUNT_JSON` (a service account with the "Firebase Cloud Messaging API
    Admin" role).
  - Until then, alerts and updates stay `pending` and are in-app only. The log says so at start-up and
    `/api/health` shows `push: not_configured`.
- **Device registration:** the API (`POST /api/v1/devices`) exists. The web app does **not** register tokens yet.
  That needs:
  - a Firebase web app config;
  - a VAPID key;
  - a messaging service worker.

  None exists in this repository, and adding the Firebase SDK was out of scope without credentials.
- **Responders:** an account becomes a responder only through the database
  (`update public.profiles set role = 'responder' where id = …`). With zero responder accounts, travellers are told
  "nobody at TravelSphere will see this".
- **SMS:** not integrated. A paid provider (for example Twilio) would need an account, a sending number, a budget,
  and consent handling for contacts.

## 8. Emergency number data sources

Checked on 2026-11-25. "Verified" means the official page was read and states the number.

| Countries | Numbers | Source | Status |
|---|---|---|---|
| 26 EU member states (all except France) | 112 | [European Commission, Your Europe: Emergency number 112](https://europa.eu/youreurope/citizens/travel/safety/emergency/index_en.htm), "112 is the only number you can use to access the emergency services in all EU countries" | Verified |
| France | 112; 15 SAMU; 17 police; 18 fire | [Service-Public.gouv.fr F33954](https://www.service-public.gouv.fr/particuliers/vosdroits/F33954) | Verified |
| Iceland | 112 | [112.is](https://www.112.is/en) | Verified |
| United Kingdom | 999, 112 | [GOV.UK: 999 and 112](https://www.gov.uk/guidance/999-and-112-the-uks-national-emergency-numbers) | Verified |
| Japan | 110 police; 119 fire and ambulance | [City of Yokohama](https://www.city.yokohama.lg.jp/lang/residents/en/emergencies/20200221091958448.html) (also Shinjuku City) | Verified |
| New Zealand | 111 | [govt.nz: 111 emergency service](https://www.govt.nz/browse/law-crime-and-justice/crimes-and-emergencies/111-emergency-service/) | Verified |
| Singapore | 999 police; 995 fire and ambulance | [police.gov.sg](https://www.police.gov.sg/), [scdf.gov.sg](https://www.scdf.gov.sg/) | Verified |
| United Arab Emirates | 999 police; 998 ambulance; 997 civil defence | [u.ae](https://u.ae/en) "Emergency Contacts" | Verified |
| Thailand | 191 police; 1669 medical; 1155 tourist police | [thailand.go.th](https://thailand.go.th/issue-focus-detail/essential-tourist-assistance-contact-numbers-to-ensure-a-smooth-and-safe-journey) | Verified (no fire number stated) |
| Switzerland | 112 | [European Commission: 112](https://digital-strategy.ec.europa.eu/en/policies/112) ("also used … such as Switzerland") | Verified |
| United States, Canada, India, Australia | 911; 911; 112; 000 and 112 (mobile) | 911.gov, CRTC, Ministry of Home Affairs (ERSS), infrastructure.gov.au | **Unconfirmed**: the official pages blocked automated reading (403 or timeout). The app shows "Not yet confirmed … double-check locally". |
| Indonesia | 112; 110 police; 113 fire | IndonesiaBaik.id infographic | **Unconfirmed**: publisher not shown and the page is several years old. Ambulance numbers are Jakarta-only, so they are omitted. |

Any other country shows "TravelSphere has no verified emergency number for …" and no number. To add a country, read
its official page, add the entry with `source` and `checked`, and keep the data test passing.

## 9. Tests actually executed (2026-11-25)

| Suite | Command | Result |
|---|---|---|
| Server (Express + Postgres) | `cd server && npx vitest run` | **85 passed** (4 files) |
| Web (React) | `npx vitest run` | **185 passed** (19 files) |
| Risk service (Python) | `cd risk-service && .venv/bin/python -m pytest -q` | **147 passed** |
| Type checks / build | `tsc --noEmit` (server, web); `npm run build` | Clean |

New or rewritten emergency tests:

- **`server/test/v1.test.ts`** (10 new):
  - SOS idempotency and critical priority.
  - One responder alert, with no coordinates.
  - Medical, lost-document and local-help creation with details.
  - Invalid details, unknown category and bad request id rejected.
  - Reporter-only location update, and 409 after resolution.
  - `by_responder` in history.
  - Assignment only to responders.
  - Location coarsening.
  - Capabilities.
  - Nearby lookup: validation, 401 and 503.
  - Push: pending without FCM, failure logged, accepted when FCM accepts.
- **`risk-service/tests/test_emergency_facilities.py`** (6 new):
  - Phone parsing never invents a number.
  - A clinic is never assumed to have an emergency department.
  - Rounded query centre and true-distance filtering.
  - A failure is not cached as "empty".
  - Empty area.
  - Country lookup, with and without the boundary file.
- **`src/tests/unit/emergencySOS.test.tsx`** (23 new):
  - SOS with GPS.
  - Permission denied.
  - Send without waiting for GPS.
  - Network failure, then retry with the same id.
  - Double tap sends once.
  - 401, 400, 429 and 500 explained.
  - Offline.
  - Number table integrity.
  - Verified, unconfirmed and unknown countries; manual choice; location failure.
  - Facilities list, empty, failed and error states.
  - Status wording.
  - Reporter and responder detail views; not-found.
- **`src/tests/unit/emergencyUI.test.tsx`** (8, rewritten):
  - Landing has no invented claims.
  - Medical success, and medical failure then retry.
  - Lost documents; local help; no session.
  - Hotel saved on the device.
  - Device-only history and detail, with no simulated reply.
- **`src/tests/unit/complaintService.test.ts`** (6, rewritten):
  - No demo seeding; old demo tickets removed.
  - Honest history; no fake replies.

**Browser check** (Chrome via Playwright, local stack on separate ports, desktop 1360 px and phone 390 px):

1. Landing page: no invented hotline, no horizontal overflow.
2. SOS with GPS: registered as `INC-…`, location included, France's numbers resolved from the position.
3. The incident page showed "Registered".
4. A responder account opened the console, assigned the incident and acknowledged it with a note.
5. The traveller's page then showed "Acknowledged · assigned" and the responder's note.

There were no console errors. The test accounts and incidents were deleted from the local database afterwards.

**Not verified live:** a successful OpenStreetMap lookup. The public Overpass servers were unreachable from the
build machine. The live call returned `error: "overpass: no response within 45 s"`, and the UI correctly showed
"lookup failed", not "nothing nearby". Successful lookups are covered by tests with mocked Overpass data.

## 10. Remaining limitations

- **Nobody is on duty by default.** With zero responder accounts, an SOS only creates a record. The app says this. An
  operating responder team, with rotas and response targets, is an organisational decision, not code.
- **No push to devices yet.** The web app has no FCM token registration (see §7). Responders must have the app open,
  or check it, to see alerts. Traveller pages refresh every 30 s while open.
- **Live location tracking** is not implemented. The reporter can add or correct a location once at a time.
- **Unauthenticated travellers** can't register incidents in production. Without a Supabase session the app explains
  this and shows the numbers. An anonymous SOS endpoint was not added because it would need abuse controls (CAPTCHA,
  device attestation) that are a product decision.
- **Offline:** the numbers table ships inside the app bundle and the last country is remembered. But there is no
  service worker, so a page not already open won't load without a network.
- **Emergency numbers:** 5 countries are unconfirmed, and only about 45 countries are covered at all. Numbers change;
  the check date is shown and should be refreshed periodically.
- **OpenStreetMap completeness** varies by country. Distances are straight-line, not travel time. The public Overpass
  mirrors are often slow or unavailable; a self-hosted Overpass or a commercial places API would make this reliable.
- **Country boundaries** (Natural Earth 1:50m, de facto) can be wrong near borders and for disputed areas, which
  return no country. The boundary file is not in git; download it with:
  `curl -L -o risk-service/data/naturalearth/ne_50m_admin_0_countries.zip https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip`
- **Health details** (allergies, conditions) entered in the medical form are stored server-side and visible to
  responder accounts. They are covered by RLS but not encrypted at the field level, and there is no retention limit for
  them yet.
- **Hotel complaints** remain on the device. The "TravelSphere Hotel Directory" list in that form is still the old
  hard-coded catalogue, and should come from real bookings or the LiteAPI.

## 11. Features that need external credentials or partnerships

| Feature | Needs |
|---|---|
| Push notifications to phones and browsers | Firebase project, service account (`FCM_*`), web config, VAPID key, service worker |
| SMS to trusted contacts | Paid SMS provider account, sending number, budget, consent flow |
| Forwarding to emergency services (e.g. location to a 112/911 centre) | Formal agreements with each public-safety answering point, or a licensed intermediary such as RapidSOS (US-focused). Not possible as an app feature alone. |
| Embassy or consular contact | Data agreements per country, or a maintained official directory |
| Hotel complaint forwarding | Hotel or booking-provider integration (e.g. LiteAPI booking support channels) |
| Confirming the unconfirmed numbers | Manual reading of the official pages (blocked to automated checks) |
| Reliable facility lookups | Self-hosted Overpass or a commercial places API |

## Demo dispatch (added 27 Nov 2026, demo only)

For demonstrations, the SOS screen asks **what is happening** and offers nine types: medical, accident, theft,
assault or harassment, fire, flood/storm/landslide, lost or stranded, lost passport, and unsafe place. There is also
"Register SOS with my location" for an unknown emergency. The type is stored in `details.emergency_type` and mapped
to an incident category (theft, assault and lost passport map to `security`).

When `DEMO_DISPATCH_NUMBER` is set in `server/.env` (git-ignored; never commit a real number), every new SOS is also
texted to that **one number**, which stands in for the local emergency service.

- **Delivery.** The text is sent through the Mac's Messages app (AppleScript, `DEMO_DISPATCH_TRANSPORT=macos-messages`),
  or printed to the server log (`log`). It is ignored when `NODE_ENV=production`.
- **Message content.** Emergency type and the service it is meant for; the reference and time (IST); the traveller's
  name and phone if known; the current hotel stay from a confirmed booking covering today; GPS with a map link; and a
  line saying the alert is **not verified**.
- **What the traveller sees.** Exactly what happened: "handed to Messages", "not sent" with the reason (for example
  "Messages is not signed in on this Mac"), and a WhatsApp click-to-chat link with the same text. The screen states
  that real hospitals, police and 112 are not contacted.
- **Audit.** An incident note records whether the demo message was sent.

"Sent" means Messages accepted the message for sending, not that anyone read it. Setup: sign in to Messages with an
Apple ID. For SMS to non-iPhone numbers, turn on Text Message Forwarding on the iPhone. Allow the terminal or Node to
control Messages when macOS asks.
