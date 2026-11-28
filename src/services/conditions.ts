// Live safety conditions from the API (scoring-v2: eight risk factors, confidence and destination score kept separate).
import { useEffect, useState } from 'react';
import { api, getSession, ensureSession } from './apiClient';

export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export type DataStatus = 'CURRENT' | 'STALE' | 'PARTIAL' | 'UNAVAILABLE';

export type CertaintyLevel = 'high' | 'medium' | 'low';

/** Short label for how sure the assessment is. Deliberately NOT called "confidence" on screen: travellers read
 *  "high confidence" as "safe to go", but it only describes the data behind the rating. */
export const CERTAINTY_LABEL: Record<CertaintyLevel, string> = {
  high: 'Very sure', medium: 'Fairly sure', low: 'Not sure',
};

/**
 * What the risk level and the certainty mean together, in plain words, and what the traveller should do.
 *   high   → trust the rating as it is (whether it says safe or dangerous)
 *   medium → the rating stands, but some data is missing or old: check again before going
 *   low    → do not rely on the rating: check official weather and safety services
 */
export function certaintyMessage(level: RiskLevel | null, certainty: CertaintyLevel, missing: string[] = []):
  { title: string; body: string } {
  const risk = level ? LEVEL_LABEL[level].toLowerCase() : 'no rating';
  const gaps = missing.length ? ` (missing: ${missing.join(', ')})` : '';
  if (certainty === 'high') {
    const body = level === 'HIGH' || level === 'CRITICAL'
      ? `This ${risk} rating is based on complete, current data — the danger is real. Take the recommended action seriously.`
      : level === 'MODERATE'
        ? 'This rating is based on complete, current data. Take the precautions below.'
        : 'This rating is based on complete, current data. Conditions can still change, so check again before you go.';
    return { title: `We are very sure about this ${risk} rating`, body };
  }
  if (certainty === 'medium') {
    return { title: `Fairly sure — this ${risk} rating could change`,
      body: `Some information is missing or old${gaps}. Use the rating, but check again shortly before you go.` };
  }
  return { title: 'Not sure — do not rely on this rating',
    body: `Too little current information${gaps}. Check official weather and civil-protection services before you travel.` };
}

export interface PlaceConditions {
  place_id: string;
  risk_level: RiskLevel | null;
  data_status: DataStatus;
  factors_available: number;
  factors_total?: number;
  /** Confidence in the data behind the assessment — never part of the risk level. Null from the fallback engine. */
  confidence?: { score: number; level: CertaintyLevel; explanation: string; weakest: string | null;
    components: Record<string, number>; missing?: string[] } | null;
  /** Tourist Confidence Score (destination background score, 0–100); provisional while a factor is missing. */
  destination_score?: { score: number | null; band: string | null; provisional: boolean; explanation: string;
    components: { key: string; label: string; weight: number; score: number | null; note: string }[] } | null;
  headline: string;
  observed_at: string | null;
  weather: { summary: string; temperatureC: number | null; rainRateMmH: number | null; windGustMs: number | null } | null;
}

export interface Factor {
  key: string;
  label: string;
  value: number | null;
  status: 'live' | 'derived' | 'configured' | 'default' | 'unavailable';
  detail: string;
  dimension?: 'hazard' | 'exposure' | 'journey_context' | 'response_capacity' | null;
}

/** Historical frequency of a hazard near a place (risk-service climatology): a hazard probability, not harm. */
export interface HazardClimate {
  p_period: number;            // chance over the assessed period (next 7 days for a place)
  period_days: number;
  scope: 'destination' | 'journey';
  p_week: number;
  annual_rate: number;         // occurrences per year (Poisson rate, -ln(1-p) summed): used for cyclone passes
  expected_weeks_per_year?: number;  // sum of weekly probabilities: used for flood-affected weeks (absent in older data)
  peak_week_start: string;     // e.g. "20 Aug"
  p_peak_week: number;
  monthly_p_week: number[];    // 12 values, Jan..Dec: chance in a typical week of that month
  years: [number, number];
  definition: string;
}

export interface HazardOutlook {
  cyclone: HazardClimate | null;
  flood: HazardClimate | null;
  unavailable: Record<string, string>;   // hazard -> why it has no figure
}

export interface PlaceAssessment extends PlaceConditions {
  factors: Factor[];
  reasons: string[];
  recommended_action: string;
  observation_age_min: number | null;
  model_version: string;
  uncertainty: string;
  notice: string;
  hazard_outlook?: HazardOutlook | null;
}

export type ConditionsState =
  | { state: 'signed-out' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; byPlace: Record<string, PlaceConditions> };

const REFRESH_MS = 10 * 60_000;
let shared: { at: number; promise: Promise<Record<string, PlaceConditions>> } | null = null;

// One request serves every card on screen; refreshed at most every 10 minutes
function loadAll(force = false) {
  if (!force && shared && Date.now() - shared.at < REFRESH_MS) return shared.promise;
  const promise = api<{ places: PlaceConditions[] }>('/places/conditions')
    .then(r => Object.fromEntries(r.places.map(p => [p.place_id, p])));
  shared = { at: Date.now(), promise };
  promise.catch(() => { shared = null; });
  return promise;
}

export function useConditions(): ConditionsState {
  const [s, setS] = useState<ConditionsState>({ state: 'loading' });

  useEffect(() => {
    let alive = true;
    const run = async (force = false) => {
      if (!getSession() && !(await ensureSession())) { if (alive) setS({ state: 'signed-out' }); return; }
      loadAll(force)
        .then(byPlace => alive && setS({ state: 'ready', byPlace }))
        .catch(err => alive && setS({ state: 'error', message: err?.message || 'Conditions unavailable' }));
    };
    run();
    const t = setInterval(() => run(true), REFRESH_MS);
    const onAuth = () => run(true);
    window.addEventListener('auth-change', onAuth);
    return () => { alive = false; clearInterval(t); window.removeEventListener('auth-change', onAuth); };
  }, []);

  return s;
}

export const fetchAssessment = (placeId: string) =>
  api<{ assessment: PlaceAssessment }>(`/places/${placeId}/assessment`).then(r => r.assessment);

export const LEVEL_LABEL: Record<RiskLevel, string> = {
  LOW: 'Low risk', MODERATE: 'Moderate risk', HIGH: 'High risk', CRITICAL: 'Critical',
};

export const minutesAgo = (iso: string | null) => {
  if (!iso) return null;
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
