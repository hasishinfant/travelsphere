// Emergency workflow client: location, incident registration, nearby facilities, and the exact wording of every
// state. The wording rule: say what has actually happened — never that help is coming unless a responder said so.
import { api, ApiError, ensureSession } from './apiClient';

// ------------------------------------------------------------------ location
export type LocationFailure = 'denied' | 'timeout' | 'unavailable' | 'unsupported';
// One shape (not a union): this project compiles without strictNullChecks, where union narrowing on `ok` doesn't work
export interface LocationResult {
  ok: boolean;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  reason?: LocationFailure;   // set when ok is false
}

export function getPosition(timeoutMs = 10_000): Promise<LocationResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve({ ok: false, reason: 'unsupported' });
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      p => resolve({ ok: true, latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
      e => resolve({ ok: false, reason: e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

export const LOCATION_MESSAGE: Record<LocationFailure, string> = {
  denied: 'Location permission is blocked, so your position was not included.',
  timeout: 'Your device did not find a location in time, so your position was not included.',
  unavailable: 'Your device could not determine a location, so your position was not included.',
  unsupported: 'This browser cannot share a location, so your position was not included.',
};

// ------------------------------------------------------------------ incidents
export type IncidentStatus = 'open' | 'acknowledged' | 'in_progress' | 'resolved' | 'closed';
export type IncidentCategory = 'medical' | 'accident' | 'natural_hazard' | 'unsafe_location' | 'lost_traveller' | 'security'
  | 'other' | 'lost_documents' | 'assistance';

export interface Incident {
  id: string;
  reference: string;
  reporter_id: string;
  category: IncidentCategory;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: IncidentStatus;
  title: string;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  location_accuracy_m: number | string | null;
  occurred_at: string;
  is_sos: boolean;
  verified: boolean;
  assigned_to: string | null;
  details: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface IncidentUpdate {
  id: string;
  author_id: string | null;
  status: IncidentStatus | null;
  note: string | null;
  created_at: string;
  by_responder: boolean;
}

export interface NewIncident {
  category: IncidentCategory;
  title: string;
  description?: string;
  is_sos?: boolean;
  latitude?: number;
  longitude?: number;
  location_accuracy_m?: number;
  details?: Record<string, unknown>;
  client_request_id: string;
}

export interface Registration {
  incident: Incident;
  duplicate: boolean;
  /** Responder accounts able to see the incident; 0 = nobody at TravelSphere will. null = unknown. */
  responder_accounts: number | null;
}

export type FailureKind = 'offline' | 'network' | 'session' | 'validation' | 'rate_limited' | 'server';

export class SubmitError extends Error {
  constructor(public kind: FailureKind, message: string) { super(message); }
}

export const FAILURE_MESSAGE: Record<FailureKind, string> = {
  offline: 'Your device is offline. TravelSphere could not register this incident.',
  network: 'TravelSphere’s server could not be reached. The incident was not registered.',
  session: 'You are not signed in to TravelSphere, so the incident could not be registered.',
  validation: 'TravelSphere rejected some of the details, so the incident was not registered.',
  rate_limited: 'Too many reports were sent from this account in a short time. The incident was not registered.',
  server: 'TravelSphere’s server had an error. The incident was not registered.',
};

export function classify(err: unknown): FailureKind {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  if (err instanceof SubmitError) return err.kind;
  if (err instanceof ApiError) {
    if (err.status === 0) return 'network';
    if (err.status === 401) return 'session';
    if (err.status === 400) return 'validation';
    if (err.status === 429) return 'rate_limited';
  }
  return 'server';
}

export const newRequestId = () => crypto.randomUUID();

/** Register an incident on the server. Throws SubmitError; never pretends to succeed. */
export async function registerIncident(input: NewIncident): Promise<Registration> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new SubmitError('offline', FAILURE_MESSAGE.offline);
  if (!(await ensureSession())) throw new SubmitError('session', FAILURE_MESSAGE.session);
  try {
    return await api<Registration>('/v1/incidents', { method: 'POST', body: input });
  } catch (err) {
    const kind = classify(err);
    throw new SubmitError(kind, FAILURE_MESSAGE[kind]);
  }
}

export const addIncidentLocation = (id: string, loc: { latitude: number; longitude: number; location_accuracy_m?: number }) =>
  api<{ incident: Incident }>(`/v1/incidents/${id}/location`, { method: 'POST', body: loc });

export const listIncidents = (scope: 'mine' | 'all' = 'mine', status?: IncidentStatus) =>
  api<{ incidents: Incident[] }>(`/v1/incidents?scope=${scope}&limit=100${status ? `&status=${status}` : ''}`)
    .then(r => r.incidents);

export const getIncident = (id: string) =>
  api<{ incident: Incident & { updates: IncidentUpdate[] } }>(`/v1/incidents/${id}`).then(r => r.incident);

export const addIncidentNote = (id: string, note: string) =>
  api<{ update: IncidentUpdate }>(`/v1/incidents/${id}/notes`, { method: 'POST', body: { note } });

export const changeIncidentStatus = (id: string, body: { status: IncidentStatus; note?: string; verified?: boolean;
  assigned_to?: string | null }) =>
  api<{ incident: Incident }>(`/v1/incidents/${id}/status`, { method: 'PATCH', body });

export const getMyRole = () => api<{ profile: { id: string; role: 'traveller' | 'responder' | 'admin' } }>('/profile')
  .then(r => r.profile);

// Mirrors server/src/routes/v1/incidents.ts TRANSITIONS
export const TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  open: ['acknowledged', 'in_progress', 'resolved', 'closed'],
  acknowledged: ['in_progress', 'resolved', 'closed'],
  in_progress: ['resolved', 'closed'],
  resolved: ['in_progress', 'closed'],
  closed: [],
};

// ------------------------------------------------------------------ wording
/** What each status means — only what the backend records. Nothing here implies dispatch of emergency services. */
export const STATUS_TEXT: Record<IncidentStatus, { short: string; long: string }> = {
  open: { short: 'Registered', long: 'Registered with TravelSphere. No responder has acknowledged it yet.' },
  acknowledged: { short: 'Acknowledged', long: 'A TravelSphere responder has acknowledged it.' },
  in_progress: { short: 'Responder working on it', long: 'A TravelSphere responder has marked it as in progress.' },
  resolved: { short: 'Resolved', long: 'A TravelSphere responder marked it resolved.' },
  closed: { short: 'Closed', long: 'Closed by a TravelSphere responder.' },
};

export function statusText(i: Pick<Incident, 'status' | 'assigned_to'>) {
  const s = STATUS_TEXT[i.status];
  return i.assigned_to && (i.status === 'acknowledged' || i.status === 'in_progress')
    ? { short: `${s.short} · assigned`, long: `${s.long} It is assigned to a responder.` }
    : s;
}

export function responderText(n: number | null): string {
  if (n === null) return 'TravelSphere could not check whether any responder accounts exist.';
  if (n === 0) return 'No TravelSphere responder accounts exist on this service yet, so nobody at TravelSphere will see this. Contact emergency services or someone you trust directly.';
  return `${n} TravelSphere responder account${n === 1 ? '' : 's'} can see it.`;
}

export const NOT_DISPATCH = 'TravelSphere does not contact police, ambulance or hospitals for you.';

export const CATEGORY_LABEL: Record<IncidentCategory, string> = {
  medical: 'Medical', accident: 'Accident', natural_hazard: 'Natural hazard', unsafe_location: 'Unsafe location',
  lost_traveller: 'Lost traveller', security: 'Security', other: 'Other', lost_documents: 'Lost documents',
  assistance: 'Local help',
};

// ------------------------------------------------------------------ nearby resources & country
export interface Facility {
  osm_id: string;
  kind: 'hospital' | 'clinic' | 'police' | 'fire_station';
  name: string | null;
  latitude: number;
  longitude: number;
  distance_m: number;
  phone: string | null;
  healthcare: string | null;
  has_emergency: boolean | null;
  retrieved_at: string | null;
}

export interface FacilitiesResult {
  facilities: Facility[];
  radius_m: number;
  source: string;
  licence: string;
  cached: boolean;
  country_code: string | null;
  error: string | null;
}

export async function nearbyFacilities(latitude: number, longitude: number, radius_m = 5000): Promise<FacilitiesResult> {
  if (!(await ensureSession())) throw new SubmitError('session', 'Sign in to look up nearby facilities.');
  return api<FacilitiesResult>('/v1/emergency/resources', { method: 'POST', body: { latitude, longitude, radius_m } });
}

export async function countryAt(latitude: number, longitude: number): Promise<string | null> {
  if (!(await ensureSession())) return null;
  return api<{ country_code: string | null }>('/v1/emergency/country', { method: 'POST', body: { latitude, longitude } })
    .then(r => r.country_code).catch(() => null);
}

export const directionsUrl = (f: Pick<Facility, 'latitude' | 'longitude'>) =>
  `https://www.google.com/maps/dir/?api=1&destination=${f.latitude},${f.longitude}`;
export const osmUrl = (osmId: string) => {
  const type = { n: 'node', w: 'way', r: 'relation' }[osmId[0]] ?? 'node';
  return `https://www.openstreetmap.org/${type}/${osmId.slice(1)}`;
};

const COUNTRY_KEY = 'ts_emergency_country';
export interface StoredCountry { code: string; source: 'location' | 'manual'; at: string }
export const loadCountry = (): StoredCountry | null => {
  try { return JSON.parse(localStorage.getItem(COUNTRY_KEY) || 'null'); } catch { return null; }
};
export const saveCountry = (c: StoredCountry) => {
  try { localStorage.setItem(COUNTRY_KEY, JSON.stringify(c)); } catch { /* storage unavailable: still works this session */ }
};
