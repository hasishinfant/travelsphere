// Client for the Python risk-intelligence service. Authenticated with a shared bearer token, time-limited, and every
// response is validated with Zod before it reaches a route — a malformed response is an upstream error, never data.
import { z } from 'zod';
import type { Config } from '../config.js';
import { HttpError } from '../http.js';

const Severity = z.enum(['none', 'minor', 'moderate', 'severe', 'extreme']);
const Category = z.enum(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']);

export const FactorSchema = z.object({
  key: z.enum(['weather_severity', 'hazard_severity', 'distance_to_hazard', 'route_exposure', 'time_factor',
    'historical_incident_risk', 'population_exposure', 'data_reliability']),
  label: z.string(),
  status: z.enum(['measured', 'derived', 'configured', 'not_applicable', 'unavailable']),
  value: z.number().min(0).max(1).nullable(),
  severity_class: Severity.nullable(),
  raw_value: z.number().nullable(),
  unit: z.string().nullable(),
  inputs: z.record(z.string(), z.unknown()),
  methodology: z.string(),
  explanation: z.string(),
  observed_at: z.string().nullable(),
  computed_at: z.string(),
  data_quality: z.object({
    sources: z.array(z.string()),
    is_stale: z.boolean(),
    age_minutes: z.number().nullable().optional(),
    missing_fields: z.array(z.string()),
    notes: z.array(z.string()),
  }).passthrough(),
});
export type RiskFactor = z.infer<typeof FactorSchema>;

export const ExplanationSchema = z.object({
  summary: z.string(),
  hazard_detected: z.string().nullable(),
  contributing_inputs: z.array(z.object({ factor: z.string(), label: z.string(), value: z.number().nullable(),
    class: Severity.nullable(), explanation: z.string() })),
  location: z.string(),
  journey_effect: z.string(),
  information_age: z.string(),
  recommended_action: z.string(),
  additional_actions: z.array(z.string()),
  rules_applied: z.array(z.string()),
  missing_information: z.array(z.string()),
  assessment_status: z.string(),
  disclaimer: z.string(),
});

const Common = {
  id: z.string().uuid().nullable(),
  destination_id: z.string(),
  risk_category: Category.nullable(),
  composite_index: z.number().nullable(),
  assessment_status: z.enum(['COMPLETE', 'PARTIAL', 'INCOMPLETE']),
  data_coverage: z.number(),
  data_reliability: z.number().nullable(),
  missing_indicators: z.array(z.string()),
  critical_override: z.boolean(),
  override_event: z.record(z.string(), z.unknown()).nullable(),
  factors: z.array(FactorSchema).length(8),
  explanation: ExplanationSchema,
  scoring_version: z.string(),
  engine_version: z.string(),
  assessed_at: z.string(),
};

export const DestinationAssessmentSchema = z.object({
  ...Common,
  destination: z.object({ id: z.string(), name: z.string(), latitude: z.number(), longitude: z.number() }),
  active_warnings: z.array(z.record(z.string(), z.unknown())),
  weather: z.object({ summary: z.string(), temperatureC: z.number().nullable(), rainRateMmH: z.number().nullable(),
    windGustMs: z.number().nullable(), observed_at: z.string() }).passthrough().nullable(),
  ml_signal: z.record(z.string(), z.unknown()).nullable(),
  inputs_hash: z.string(),
});
export type DestinationAssessment = z.infer<typeof DestinationAssessmentSchema>;

export const JourneyAssessmentSchema = z.object({
  ...Common,
  journey_id: z.string().uuid().nullable(),
  user_id: z.string().uuid(),
  dimensions: z.object({ hazard: z.record(z.string(), z.unknown()), exposure: z.record(z.string(), z.unknown()),
    journey_context: z.record(z.string(), z.unknown()), response_accessibility: z.record(z.string(), z.unknown()) }),
  route: z.record(z.string(), z.unknown()).nullable(),
  safer_route: z.record(z.string(), z.unknown()),
  activity: z.string(),
  travellers: z.number().int(),
  travel_start: z.string(),
  travel_end: z.string(),
});
export type JourneyAssessment = z.infer<typeof JourneyAssessmentSchema>;

export interface JourneyAssessmentInput {
  user_id: string;
  journey_id?: string | null;
  destination_id: string;
  origin?: { latitude: number; longitude: number } | null;
  current_location?: { latitude: number; longitude: number; accuracy_m?: number | null } | null;
  waypoints?: { latitude: number; longitude: number }[];
  travel_start: string;
  travel_end?: string | null;
  activity?: string;
  activity_duration_minutes?: number;
  travellers?: number;
  transport_mode?: 'driving' | 'foot';
  persist?: boolean;
}

// Nearby emergency facilities from OpenStreetMap (via the risk service's cached Overpass adapter)
export const FacilitiesSchema = z.object({
  facilities: z.array(z.object({
    osm_id: z.string(),
    kind: z.enum(['hospital', 'clinic', 'police', 'fire_station']),
    name: z.string().nullable(),
    latitude: z.number(),
    longitude: z.number(),
    distance_m: z.number(),
    phone: z.string().nullable(),
    healthcare: z.string().nullable(),
    has_emergency: z.boolean().nullable(),
    retrieved_at: z.string().nullable(),
  })),
  radius_m: z.number(),
  source: z.string(),
  licence: z.string(),
  cached: z.boolean(),
  country_code: z.string().length(2).nullable(),
  error: z.string().nullable(),
});
export type Facilities = z.infer<typeof FacilitiesSchema>;

export const CountrySchema = z.object({ country_code: z.string().length(2).nullable() });

export interface RiskService {
  countryAt?(latitude: number, longitude: number): Promise<{ country_code: string | null }>;
  facilitiesNear?(latitude: number, longitude: number, radiusM: number): Promise<Facilities>;
  assessDestination(destinationId: string): Promise<DestinationAssessment>;
  assessJourney(input: JourneyAssessmentInput): Promise<JourneyAssessment>;
  health(): Promise<{ status: string; engine_version?: string } | null>;
}

type FetchFn = typeof fetch;

export function createRiskService(config: Pick<Config, 'RISK_SERVICE_URL' | 'RISK_SERVICE_TOKEN' | 'RISK_SERVICE_TIMEOUT_MS'>,
  fetchFn: FetchFn = fetch): RiskService {
  const base = config.RISK_SERVICE_URL.replace(/\/$/, '');

  async function call<T extends z.ZodType>(path: string, body: unknown, schema: T,
    timeoutMs = config.RISK_SERVICE_TIMEOUT_MS): Promise<z.infer<T>> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchFn(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
          ...(config.RISK_SERVICE_TOKEN ? { Authorization: `Bearer ${config.RISK_SERVICE_TOKEN}` } : {}) },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      const timedOut = (err as Error)?.name === 'AbortError';
      throw new HttpError(timedOut ? 504 : 503, 'risk_service_unavailable',
        timedOut ? 'The risk assessment took too long' : 'The risk assessment service is unavailable');
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => null);
    if (res.status === 404) throw new HttpError(404, 'not_found', (data as any)?.detail || 'Not found');
    if (res.status === 403) throw new HttpError(403, 'forbidden', 'Not allowed');
    if (res.status === 422 || res.status === 400) {
      throw new HttpError(400, 'validation_failed', 'The assessment request is invalid', (data as any)?.error?.details);
    }
    if (!res.ok) throw new HttpError(502, 'risk_service_error', 'The risk assessment service failed');
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      console.error('[risk-service] response failed validation:', parsed.error.issues.slice(0, 3));
      throw new HttpError(502, 'risk_service_invalid_response', 'The risk assessment service returned invalid data');
    }
    return parsed.data;
  }

  return {
    assessDestination: id => call('/internal/v1/assessments/destination', { destination_id: id, persist: true },
      DestinationAssessmentSchema),
    assessJourney: input => call('/internal/v1/assessments/journey', { persist: true, ...input }, JourneyAssessmentSchema),
    countryAt: (latitude, longitude) => call('/internal/v1/country', { latitude, longitude }, CountrySchema, 10_000),
    facilitiesNear: (latitude, longitude, radius_m) =>
      call('/internal/v1/facilities', { latitude, longitude, radius_m }, FacilitiesSchema, 60_000), // > the risk service's 45 s Overpass deadline, so its "lookup failed" answer arrives
    async health() {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3000);
        const res = await fetchFn(`${base}/health`, { signal: ctrl.signal }).finally(() => clearTimeout(t));
        return res.ok ? ((await res.json()) as { status: string; engine_version?: string }) : null;
      } catch {
        return null;
      }
    },
  };
}
