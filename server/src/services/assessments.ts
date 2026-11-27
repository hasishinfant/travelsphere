// Destination assessments: served from the database while fresh, recomputed by the risk service when stale.
// Also maps the 8-factor result onto the shape the existing place UI already renders (no frontend change needed).
import { z } from 'zod';
import type { Db } from '../db.js';
import type { Confidence, DestinationAssessment, DestinationScore, RiskService } from '../integrations/riskService.js';

// Climatological hazard probabilities reported by Factor 6 (risk-service docs/ML.md). Hazard probabilities, not harm.
const Outlook = z.object({
  p_period: z.number().min(0).max(1), period_days: z.number(), scope: z.enum(['destination', 'journey']),
  p_week: z.number().min(0).max(1), annual_rate: z.number().min(0), peak_week_start: z.string(),
  // expected affected weeks per year (floods); absent in assessments stored before it existed
  expected_weeks_per_year: z.number().min(0).optional(),
  p_peak_week: z.number().min(0).max(1), monthly_p_week: z.array(z.number().min(0).max(1)).length(12),
  years: z.tuple([z.number(), z.number()]), definition: z.string(),
});
export type HazardOutlook = {
  cyclone: z.infer<typeof Outlook> | null;
  flood: z.infer<typeof Outlook> | null;
  unavailable: Record<string, string>;
};

/** The cyclone and flood outlook from Factor 6's inputs; a malformed entry is dropped, never guessed. */
export function hazardOutlook(factors: { key: string; inputs?: unknown }[]): HazardOutlook | null {
  const inputs = factors.find(f => f.key === 'historical_incident_risk')?.inputs as Record<string, unknown> | undefined;
  if (!inputs) return null;
  const pick = (k: string) => {
    if (inputs[k] == null) return null;
    const r = Outlook.safeParse(inputs[k]);
    return r.success ? r.data : null;
  };
  const unavailable = z.record(z.string(), z.string()).safeParse(inputs.climatology_unavailable ?? {});
  const out = { cyclone: pick('cyclone'), flood: pick('flood'), unavailable: unavailable.success ? unavailable.data : {} };
  return out.cyclone || out.flood || Object.keys(out.unavailable).length ? out : null;
}

// scoring-v2 factors, in display order, with their dimension
export const FACTOR_LABELS: Record<string, string> = {
  weather_severity: 'Weather severity',
  hazard_severity: 'Active hazards',
  hazard_exposure: 'Hazard exposure',
  terrain: 'Terrain',
  activity_timing: 'Activity and timing',
  historical_incident_risk: 'Hazard history',
  emergency_access: 'Access to emergency care',
  remoteness: 'Remoteness',
};
export const FACTOR_DIMENSION: Record<string, string> = {
  weather_severity: 'hazard', hazard_severity: 'hazard', hazard_exposure: 'exposure', terrain: 'exposure',
  activity_timing: 'journey_context', historical_incident_risk: 'journey_context',
  emergency_access: 'response_capacity', remoteness: 'response_capacity',
};
// Keys of assessments stored under scoring-v1 (shown only until a fresh assessment replaces them)
const LEGACY_LABELS: Record<string, string> = {
  distance_to_hazard: 'Distance to hazard', route_exposure: 'Route exposure', time_factor: 'Time factor',
  population_exposure: 'Population exposure', data_reliability: 'Data reliability',
};
const labelOf = (k: string) => FACTOR_LABELS[k] ?? LEGACY_LABELS[k] ?? k;

/** Latest stored destination assessment (with its factors), or null if none / older than maxAgeMin. */
export async function latestDestinationAssessment(db: Db, destinationId: string, maxAgeMin?: number) {
  const { rows } = await db.query(
    `select a.*, d.name as destination_name, d.latitude, d.longitude
     from public.destination_assessments a join public.destinations d on d.id = a.destination_id
     where a.destination_id = $1 and ($2::int is null or a.assessed_at > now() - make_interval(mins => $2::int))
     order by a.assessed_at desc limit 1`,
    [destinationId, maxAgeMin ?? null],
  );
  const a = rows[0];
  if (!a) return null;
  const { rows: factors } = await db.query(
    `select factor_key as key, status, value, severity_class, raw_value, unit, inputs, source_ids, explanation,
            data_quality, observed_at, computed_at
     from public.factor_assessments where destination_assessment_id = $1`, [a.id]);
  return { a, factors: factors.map(f => ({ ...f, label: labelOf(f.key), value: f.value === null ? null : Number(f.value),
    raw_value: f.raw_value === null ? null : Number(f.raw_value) })) };
}

/** Shape a stored row like a freshly computed assessment. */
export function storedToAssessment(s: NonNullable<Awaited<ReturnType<typeof latestDestinationAssessment>>>) {
  const { a, factors } = s;
  const order = [...Object.keys(FACTOR_LABELS), ...Object.keys(LEGACY_LABELS)];
  return {
    id: a.id, destination_id: a.destination_id,
    destination: { id: a.destination_id, name: a.destination_name, latitude: a.latitude, longitude: a.longitude },
    risk_category: a.risk_category, composite_index: a.composite_index === null ? null : Number(a.composite_index),
    assessment_status: a.assessment_status, data_coverage: Number(a.data_coverage),
    data_reliability: a.data_reliability === null ? null : Number(a.data_reliability),
    confidence: a.confidence ?? null, destination_score: a.destination_score ?? null, population: a.population ?? null,
    missing_indicators: a.missing_indicators, active_warnings: a.active_warnings, critical_override: a.critical_override,
    explanation: a.explanation, ml_signal: a.ml_signal,
    factors: factors.sort((x, y) => order.indexOf(x.key) - order.indexOf(y.key)),
    scoring_version: a.scoring_version, engine_version: a.engine_version,
    assessed_at: new Date(a.assessed_at).toISOString(), source: 'stored' as const,
  };
}

export async function destinationExists(db: Db, id: string): Promise<boolean> {
  const { rows } = await db.query('select 1 from public.destinations where id = $1 and active', [id]);
  return rows.length > 0;
}

export async function getOrAssessDestination(db: Db, risk: RiskService, id: string, maxAgeMin: number, force = false) {
  if (!force) {
    const stored = await latestDestinationAssessment(db, id, maxAgeMin);
    if (stored) return storedToAssessment(stored);
  }
  const fresh = await risk.assessDestination(id);
  return { ...fresh, source: 'computed' as const };
}

// ------------------------------------------------------------------ legacy place-card mapping
type AnyAssessment = Pick<DestinationAssessment, 'destination_id' | 'risk_category' | 'assessment_status' |
  'scoring_version' | 'engine_version' | 'data_reliability' | 'assessed_at'> & {
  confidence?: Confidence | null;
  destination_score?: DestinationScore | null;
  factors: { key: string; label?: string; status: string; value: number | null; explanation: string; inputs?: unknown;
    data_quality: { is_stale?: boolean } | Record<string, unknown>; observed_at?: string | null }[];
  explanation: { summary: string; recommended_action: string; rules_applied: string[]; contributing_inputs: { explanation: string }[] };
  weather?: unknown;
};

const LEGACY_STATUS: Record<string, string> = { measured: 'live', derived: 'derived', configured: 'configured',
  not_applicable: 'unavailable', unavailable: 'unavailable' };

export function toPlaceShape(x: AnyAssessment, weather: unknown) {
  // Confidence is evidence quality, not risk: it is returned separately and never drawn as a risk bar
  const factors = x.factors.filter(f => f.key !== 'data_reliability').map(f => {
    const base = { key: f.key, label: f.label ?? labelOf(f.key), dimension: FACTOR_DIMENSION[f.key] ?? null };
    if (f.status === 'not_applicable') {
      return { ...base, value: null, status: 'unavailable', detail: 'Applies to journeys — plan a trip to assess your route' };
    }
    return { ...base, value: f.value, status: LEGACY_STATUS[f.status], detail: f.explanation };
  });
  const conf = x.confidence ?? null;
  const stale = x.factors.some(f => (f.data_quality as { is_stale?: boolean })?.is_stale);
  const dataStatus = x.assessment_status === 'INCOMPLETE' ? 'UNAVAILABLE' : stale ? 'STALE'
    : x.assessment_status === 'PARTIAL' ? 'PARTIAL' : 'CURRENT';
  const w = weather as { summary?: string; temperatureC?: number | null; rainRateMmH?: number | null;
    windGustMs?: number | null; observed_at?: string } | null | undefined;
  const weatherFactor = x.factors.find(f => f.key === 'weather_severity');
  const observed = w?.observed_at ?? weatherFactor?.observed_at ?? null;
  const reasons = [...x.explanation.rules_applied, ...x.explanation.contributing_inputs.map(c => c.explanation)];
  return {
    place_id: x.destination_id,
    risk_level: x.risk_category,
    data_status: dataStatus,
    factors_available: factors.filter(f => ['live', 'derived', 'configured'].includes(f.status)).length,
    factors_total: factors.length,
    confidence: conf ? { score: conf.score, level: conf.level, explanation: conf.explanation, weakest: conf.weakest,
      components: conf.components } : null,
    destination_score: x.destination_score ?? null,
    headline: x.explanation.summary,
    observed_at: observed,
    weather: w ? { summary: w.summary ?? 'Unknown', temperatureC: w.temperatureC ?? null, rainRateMmH: w.rainRateMmH ?? null,
      windGustMs: w.windGustMs ?? null } : null,
    factors,
    reasons: reasons.length ? reasons : [x.explanation.summary],
    recommended_action: x.explanation.recommended_action,
    observation_age_min: observed ? Math.round((Date.now() - Date.parse(observed)) / 60_000) : null,
    model_version: `${x.scoring_version} (${x.engine_version})`,
    uncertainty: `Rule-based and not calibrated against incidents; confidence in the data ${conf ? `${conf.level} (${conf.score}/100)`
      : x.data_reliability === null ? 'unknown' : `${Math.round(x.data_reliability * 100)}/100`}`,
    notice: 'Travel safety information only. Always follow official warnings and local emergency services.',
    hazard_outlook: hazardOutlook(x.factors),
  };
}

/** Weather summary is not stored as a column; rebuild it from the stored weather factor inputs. */
export function weatherFromFactors(factors: { key: string; inputs?: any; observed_at?: string | null }[]) {
  const w = factors.find(f => f.key === 'weather_severity');
  const cur = w?.inputs?.current;
  if (!cur) return null;
  const WMO: Record<number, string> = { 0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog',
    48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Rain showers', 81: 'Rain showers', 82: 'Violent rain showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail' };
  return { summary: cur.weather_code == null ? 'Unknown' : WMO[cur.weather_code] ?? `WMO code ${cur.weather_code}`,
    temperatureC: cur.temperature_c, rainRateMmH: cur.precipitation_mm_h, windGustMs: cur.wind_gust_ms,
    observed_at: w?.observed_at ? new Date(w.observed_at).toISOString() : undefined };
}
