# Emergency system audit

Audit of TravelSphere's SOS and emergency-support workflows, made **before** any change on 2026-11-25 (base commit
`26d4722`). It records what the code actually did, not what the UI said it did. The changes that followed are in
[EMERGENCY_SYSTEM_IMPLEMENTATION_REPORT.md](EMERGENCY_SYSTEM_IMPLEMENTATION_REPORT.md).

## 1. Summary

The backend had a real, access-controlled incident system. The frontend did not use it. Every emergency screen stored
data in the browser's `localStorage` only, and several screens told the traveller that people were acting on it when
nobody could see it.

| Area | Finding | Severity |
|---|---|---|
| SOS button | Opened the phone's SMS app with a message to a number typed each time. A fixed 1.2 s spinner said "Sending SOS…". Nothing reached the server. | Critical |
| Medical / lost-passport / local-help forms | Saved to `localStorage` only. Success screens said a "medical coordinator has received your case", a "consular liaison team is compiling…", a "regional concierge team is matching your case". No such people or systems existed. | Critical |
| Landing page | Showed an invented hotline (`+1-800-555-SAFE`), a "15-Minute Response Protocol", "Direct Hotel Escalation", and number chips such as "Asia 112 / 100" linked to `tel:112`. | Critical |
| Demo data | Two demo tickets with invented coordinators and replies were seeded into every new browser and shown as the traveller's own requests. | High |
| Ticket detail | Posting a message triggered a fake "Support Officer" reply after 1.2 s; a "Live Channel" badge; "Simulate Status Transition (Demo)" buttons. | High |
| Forms | Pre-filled a fake phone number `+1 (555) 234-5678` and insurer "Allianz Global Assistance". | Medium |
| Unused `EmergencyDashboard` | Not rendered anywhere, but promised "Our emergency response team will be notified immediately" and "A specialist will contact you within 15 minutes". | Low (dead code) |
| Sidebar / login | "24/7" badge on Emergency; "24/7 help" on the login page. | Medium |

## 2. Existing behaviour (as found)

### `src/components/emergency/SOSButton.tsx`
- Steps: `phone-entry` → `confirm` → `sending` → `sent`.
- `handleSendSOS` waited `setTimeout(1200)`, then set `window.location.href = sms:<number>?body=…` and showed "SOS Alert Ready!".
- Location from `navigator.geolocation` (8 s timeout); on failure the message said "Location: Unavailable".
- No server call, no record, no retry. On desktop browsers the `sms:` link usually does nothing, but the UI still
  reached the "ready" state.

### `src/services/complaintService.ts`
- All four request types (`hotel`, `medical`, `passport`, `local`) were written to `localStorage['travelsphere_emergency_complaints']`.
- Each submit added a scripted status note ("Consular liaison notified", "Case dispatched to hospitality liaison
  team") and a scripted message from "Medical SOS Dispatch", "Consular Assistance Desk", "TravelSphere Local Concierge"
  or "TravelSphere Hotel Liaison Bot".
- `addFollowUpMessage` posted a fake reply from "Support Officer" 1.2 s later.
- `getStoredRequests` seeded `INITIAL_DEMO_RECORDS` when storage was empty.

### Emergency views
- `MedicalEmergencyView`, `LostPassportView`, `LocalAssistanceView` called the local service, then showed the claims
  listed above. Errors used `alert()`.
- `EmergencyLandingView` listed hard-coded number chips and the invented hotline.
- `ComplaintHistoryView` / `ComplaintDetailView` presented the local records as tickets with "real-time status updates,
  liaison messages, and hotel management responses".
- `EmergencyPage` routes: `/emergency-support`, `/:tab`, `/requests/:requestId`.

## 3. Existing API capabilities (unused by the frontend)

`server/src/routes/v1/incidents.ts`, mounted at `/api/v1/incidents` behind `requireAuth`:

| Endpoint | Behaviour |
|---|---|
| `POST /` | Zod-validated create; `is_sos: true` → priority `critical`; 10 per 15 min per user. Categories: `medical, accident, natural_hazard, unsafe_location, lost_traveller, security, other`. |
| `GET /` | Own incidents; `scope=all` for responders/admins only (403 otherwise). Ordered by priority. |
| `GET /:id` | Incident with its `incident_updates`. RLS hides other users' incidents (404). |
| `PATCH /:id/status` | Responders/admins only. Transition table `open → acknowledged/in_progress/resolved/closed`, `closed` terminal. Writes an audit row and a reporter notification. |
| `POST /:id/notes` | Reporter or staff adds a note. |

Missing for the forms: no category for lost documents or local help, no place for structured form fields, no
idempotency for retries or double taps, no way for a reporter to add a location after creating an SOS, no alert to
responders when an SOS arrives.

## 4. Database and authentication dependencies

- Tables (`supabase/migrations/0001_schema.sql`, `0004_risk_intelligence.sql`): `incidents`, `incident_updates`,
  `notifications`, `device_tokens`, `profiles.role ∈ {traveller, responder, admin}`, `emergency_facilities`,
  `facility_searches`.
- RLS (`0002_rls.sql`): reporters insert their own `open` incidents and read their own; staff read and update all;
  reporters may add notes only (no status); notifications and device tokens are own-only.
- Auth: `requireAuth` verifies Supabase JWTs (JWKS or HS256) or, in `AUTH_MODE=local`, development tokens.
  `ensureSession()` in the client creates a development session (guests included) **only** when the server offers
  `/api/auth/dev-session`, which is refused in production. A production traveller without a Supabase session therefore
  cannot register an incident; the UI must fall back to direct calling.
- There is **no responder UI** in the frontend. Roles can only be set in the database.

## 5. Notification configuration

- `server/src/integrations/fcm.ts`: FCM HTTP v1 sender (service-account JWT). Needs `FCM_PROJECT_ID` and
  `FCM_SERVICE_ACCOUNT_JSON`; neither is set in any environment checked. Without them `index.ts` logs "in-app only".
- `dispatchPending` delivered **only** `risk_warning` notifications. Incident updates were written to `notifications`
  but never pushed, and responders were never notified of new incidents.
- Device tokens: `POST/DELETE /api/v1/devices` exist; the frontend never registers a token (no Firebase web SDK, no
  service worker). Invalid tokens were already deleted on FCM 400/404.
- `delivery_status = 'sent'` means FCM accepted the message. It cannot mean a person saw it.
- No SMS provider is integrated.

## 6. Nearby resources

`risk-service/app/ingestion/overpass.py` queries OpenStreetMap (hospital, clinic, police, fire_station) through
public Overpass mirrors, cached 30 days in `emergency_facilities` / `facility_searches`. It was used only by the risk
engine's response-accessibility factor. It discarded phone tags, was not exposed to the frontend, and stored the exact
search coordinates.

## 7. Failure scenarios (as found)

| Scenario | What the traveller saw |
|---|---|
| No network | Forms "succeeded" (local storage); the SOS opened the SMS app or nothing. |
| Server down | No difference: nothing used the server. |
| Not signed in | No difference. |
| Location denied / timeout | Forms showed `alert()`; SOS message said "Location: Unavailable". |
| Double tap on submit | Two local records. |
| Desktop browser SOS | "SOS Alert Ready!" though no messaging app opened. |
| Nobody monitoring | Indistinguishable from someone monitoring — the UI claimed coordinators existed. |

## 8. Implementation plan (followed)

1. **Wording first.** Remove every claim of coordinators, dispatch, response times and 24/7 cover; remove artificial
   delays and simulated replies; stop seeding demo data and drop the old demo tickets from storage.
2. **Extend, don't duplicate, the incidents API.** Add categories `lost_documents` and `assistance`, a validated
   `details` object per category, a `client_request_id` for idempotent retries, a reporter-only location update, and
   in-app alerts to responder accounts for SOS and urgent incidents (migration `0006_emergency.sql`).
3. **SOS → incident.** Confirm, get location (skippable), create with `is_sos: true`, show the server's reference and
   status only after it answers; classify each failure and always show direct-call numbers.
4. **Forms → incidents.** Medical, lost-document and local-help forms create server incidents. Hotel complaints stay
   on the device and say so (there is no channel to hotels).
5. **Nearby facilities.** Expose the Overpass adapter through the risk service and API, with phone numbers only when
   mapped, emergency-department status only when tagged, a privacy-preserving rounded query, and explicit failure vs
   empty states.
6. **Emergency numbers.** A bundled table of numbers taken only from official pages that were read, each with its
   source and check date, country from the position (Natural Earth boundaries) with manual fallback.
7. **Push.** Deliver incident alerts and updates through the existing FCM sender when configured; log delivery errors;
   never call an accepted push "received".
8. **Responders.** A minimal console for responder accounts, using only the backend's statuses and transitions.
9. **Privacy.** Coordinates in request bodies, rounded third-party queries, no coordinates in push payloads, precise
   incident locations coarsened 30 days after resolution.
10. **Tests** for each path above.
