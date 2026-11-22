// Destination assessments: served from the database while fresh, recomputed by the risk service when stale.
// Also maps the 8-factor result onto the shape the existing place UI already renders (no frontend change needed).
import type { Db } from '../db.js';
import type { DestinationAssessment, RiskService } from '../integrations/riskService.js';

export const FACTOR_LABELS: Record<string, string> = {
  weather_severity: 'Weather severity',
  hazard_severity: 'Hazard severity',
  distance_to_hazard: 'Distance to hazard',
  route_exposure: 'Route exposure',
  time_factor: 'Time factor',
  historical_incident_risk: 'Historical incident risk',
  population_exposure: 'Population exposure',
  data_reliability: 'Data reliability',
};

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
  return { a, factors: factors.map(f => ({ ...f, label: FACTOR_LABELS[f.key], value: f.value === null ? null : Number(f.value),
    raw_value: f.raw_value === null ? null : Number(f.raw_value) })) };
}

/** Shape a stored row like a freshly computed assessment. */
export function storedToAssessment(s: NonNullable<Awaited<ReturnType<typeof latestDestinationAssessment>>>) {
  const { a, factors } = s;
  const order = Object.keys(FACTOR_LABELS);
  return {
    id: a.id, destination_id: a.destination_id,
    destination: { id: a.destination_id, name: a.destination_name, latitude: a.latitude, longitude: a.longitude },
    risk_category: a.risk_category, composite_index: a.composite_index === null ? null : Number(a.composite_index),
    assessment_status: a.assessment_status, data_coverage: Number(a.data_coverage),
    data_reliability: a.data_reliability === null ? null : Number(a.data_reliability),
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
  factors: { key: string; label?: string; status: string; value: number | null; explanation: string;
    data_quality: { is_stale?: boolean } | Record<string, unknown>; observed_at?: string | null }[];
  explanation: { summary: string; recommended_action: string; rules_applied: string[]; contributing_inputs: { explanation: string }[] };
  weather?: unknown;
};

const LEGACY_STATUS: Record<string, string> = { measured: 'live', derived: 'derived', configured: 'configured',
  not_applicable: 'unavailable', unavailable: 'unavailable' };

export function toPlaceShape(x: AnyAssessment, weather: unknown) {
  const factors = x.factors.map(f => {
    if (f.key === 'data_reliability') {
      // Evidence quality, not risk: never drawn as a risk bar
      return { key: f.key, label: 'Data reliability', value: null, status: 'derived',
        detail: `Evidence quality ${Math.round((f.value ?? 0) * 100)}/100 — ${f.explanation}` };
    }
    if (f.status === 'not_applicable') {
      return { key: f.key, label: f.label ?? FACTOR_LABELS[f.key], value: null, status: 'unavailable',
        detail: 'Applies to journeys — plan a trip to assess your route' };
    }
    return { key: f.key, label: f.label ?? FACTOR_LABELS[f.key], value: f.value, status: LEGACY_STATUS[f.status], detail: f.explanation };
  });
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
    factors_available: x.factors.filter(f => ['measured', 'derived', 'configured'].includes(f.status)).length,
    headline: x.explanation.summary,
    observed_at: observed,
    weather: w ? { summary: w.summary ?? 'Unknown', temperatureC: w.temperatureC ?? null, rainRateMmH: w.rainRateMmH ?? null,
      windGustMs: w.windGustMs ?? null } : null,
    factors,
    reasons: reasons.length ? reasons : [x.explanation.summary],
    recommended_action: x.explanation.recommended_action,
    observation_age_min: observed ? Math.round((Date.now() - Date.parse(observed)) / 60_000) : null,
    model_version: `${x.scoring_version} (${x.engine_version})`,
    uncertainty: `Rule-based and not calibrated against incidents; evidence quality ${x.data_reliability === null ? 'unknown'
      : `${Math.round(x.data_reliability * 100)}/100`}`,
    notice: 'Travel safety information only. Always follow official warnings and local emergency services.',
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
