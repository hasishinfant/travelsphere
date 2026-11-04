// 8-factor contextual safety assessment — deterministic rule baseline (model "rules-v1").
//
// Each factor is normalised to 0..1 (higher = more risk) and carries its provenance:
//   live        measured now (weather provider, database records)
//   derived     computed from the traveller's journey
//   configured  editorial/admin configuration (place setting, terrain, risk zones)
//   default     no traveller-specific data; a generic assumption was used  → NOT counted as available
//   unavailable no data                                                    → NOT counted as available
//
// Thresholds use published definitions, not tuned weights:
//   rain rate: AMS — light < 2.5, moderate 2.5–7.6, heavy > 7.6 mm/h; violent ≥ 50 mm/h (UK Met Office)
//   wind gusts: Beaufort — strong breeze ≥ 10.8, near gale ≥ 13.9, gale ≥ 17.2, storm ≥ 24.5 m/s
//   WMO 4677 weather codes for thunderstorms (95–99), snow (71–77, 85–86) and freezing rain (66–67)
//   fog: visibility < 1 km (WMO definition)
// The factor values and level rules are a prototype baseline and are NOT calibrated against incidents.
import type { Observation } from './weather.js';
import { STALE_AFTER_MIN, ageMinutes, describeWeather } from './weather.js';
import type { PlaceProfile } from '../data/places.js';

export const MODEL_VERSION = 'rules-v1';

export type FactorKey =
  | 'hazard_intensity' | 'tourist_exposure' | 'location_risk' | 'time_context'
  | 'weather_environment' | 'accessibility_remoteness' | 'historical_incidents' | 'journey_context';
export type FactorStatus = 'live' | 'derived' | 'configured' | 'default' | 'unavailable';
export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export type DataStatus = 'CURRENT' | 'STALE' | 'PARTIAL' | 'UNAVAILABLE';

export interface Factor {
  key: FactorKey;
  label: string;
  value: number | null;
  status: FactorStatus;
  detail: string;
}

export interface ZoneHit { name: string; hazard_type: string; severity: 'LOW' | 'MODERATE' | 'HIGH'; distance_m: number }

export interface JourneyCtx {
  startDate: string;  // YYYY-MM-DD
  endDate: string;
  activities: string[];
  label: string;      // "Kyoto, 12–16 Jan"
}

export interface AssessmentInput {
  place: PlaceProfile;
  observation: Observation | null;
  zones: ZoneHit[];
  incidentCount: number | null; // null = could not query
  journey: JourneyCtx | null;
  now?: Date;
}

export interface Assessment {
  placeId: string;
  riskLevel: RiskLevel | null; // null when conditions are unavailable — no assessment is made
  dataStatus: DataStatus;
  factors: Factor[];
  factorsAvailable: number;
  reasons: string[];
  recommendedAction: string;
  observedAt: string | null;
  observationAgeMin: number | null;
  weather: { summary: string; temperatureC: number | null; rainRateMmH: number | null; windGustMs: number | null } | null;
  modelVersion: string;
  uncertainty: string;
}

const round = (v: number) => Math.round(v * 100) / 100;
const AVAILABLE: FactorStatus[] = ['live', 'derived', 'configured'];

// ---------------------------------------------------------------- factor builders
interface HazardResult { value: number; drivers: { kind: string; text: string; score: number }[] }

export function hazardFrom(o: Observation): HazardResult {
  const drivers: HazardResult['drivers'] = [];
  const rain = Math.max(o.rainRateMmH ?? 0, o.next6hMaxRainMmH ?? 0);
  const rainScore = rain >= 50 ? 1 : rain > 7.6 ? 0.75 : rain >= 2.5 ? 0.45 : rain >= 0.5 ? 0.2 : 0;
  if (rainScore >= 0.45) {
    const when = (o.rainRateMmH ?? 0) >= rain ? 'now' : 'within 6 hours';
    drivers.push({ kind: 'rain', score: rainScore, text: `${rain >= 50 ? 'Violent' : rain > 7.6 ? 'Heavy' : 'Moderate'} rain ${when} (${rain} mm/h)` });
  }

  const gust = Math.max(o.windGustMs ?? 0, o.next6hMaxGustMs ?? 0);
  const gustScore = gust >= 24.5 ? 1 : gust >= 17.2 ? 0.75 : gust >= 13.9 ? 0.5 : gust >= 10.8 ? 0.3 : 0;
  if (gustScore > 0) {
    const name = gust >= 24.5 ? 'Storm-force' : gust >= 17.2 ? 'Gale-force' : gust >= 13.9 ? 'Near-gale' : 'Strong';
    drivers.push({ kind: 'wind', score: gustScore, text: `${name} gusts (${gust} m/s)` });
  }

  const code = o.weatherCode ?? -1;
  if (code >= 95) drivers.push({ kind: 'thunderstorm', score: 0.8, text: describeWeather(code) });
  else if (code === 66 || code === 67) drivers.push({ kind: 'ice', score: 0.6, text: describeWeather(code) });
  else if (code === 75 || code === 86) drivers.push({ kind: 'snow', score: 0.6, text: describeWeather(code) });
  else if ((code >= 71 && code <= 77) || code === 85) drivers.push({ kind: 'snow', score: 0.3, text: describeWeather(code) });

  const t = o.temperatureC;
  if (t !== null && t >= 40) drivers.push({ kind: 'heat', score: 0.9, text: `Extreme heat (${t} °C)` });
  else if (t !== null && t >= 35) drivers.push({ kind: 'heat', score: 0.6, text: `High heat (${t} °C)` });
  else if (t !== null && t <= -20) drivers.push({ kind: 'cold', score: 0.8, text: `Severe cold (${t} °C)` });
  else if (t !== null && t <= -10) drivers.push({ kind: 'cold', score: 0.5, text: `Cold (${t} °C)` });

  const value = Math.max(rainScore, gustScore, ...drivers.map(d => d.score), 0);
  return { value: round(value), drivers: drivers.sort((a, b) => b.score - a.score) };
}

const ACTIVITY_EXPOSURE: Record<string, number> = {
  trekking: 0.8, water: 0.7, sightseeing: 0.5, transit: 0.4, shopping: 0.3, other: 0.4, dining: 0.25, indoor: 0.15,
};
const TERRAIN_RISK: Record<string, number> = { cliffs: 0.3, coastal: 0.25, waterfall: 0.3, 'glacial-river': 0.35, volcanic: 0.2 };
const SETTING_REMOTENESS: Record<string, number> = { urban: 0.1, island: 0.35, rural: 0.5, remote: 0.8 };
const ZONE_SEVERITY: Record<string, number> = { LOW: 0.3, MODERATE: 0.6, HIGH: 0.9 };

const dayDiff = (a: string, b: Date) => Math.floor((Date.parse(`${a}T00:00:00Z`) - Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())) / 86_400_000);

// ---------------------------------------------------------------- assessment
export function assess(input: AssessmentInput): Assessment {
  const { place, observation: o, zones, incidentCount, journey } = input;
  const now = input.now ?? new Date();
  const factors: Factor[] = [];
  const age = o ? ageMinutes(o, now) : null;
  const stale = age !== null && age > STALE_AFTER_MIN;

  // 1. Hazard intensity
  const hazard = o ? hazardFrom(o) : null;
  factors.push(hazard
    ? { key: 'hazard_intensity', label: 'Hazard intensity', value: hazard.value, status: 'live',
        detail: hazard.drivers.length ? hazard.drivers.map(d => d.text).join(' · ') : 'No hazardous weather now or in the next 6 hours' }
    : { key: 'hazard_intensity', label: 'Hazard intensity', value: null, status: 'unavailable', detail: 'Weather provider unavailable' });

  // 8. Journey context (needed before exposure)
  let activityExposure = ACTIVITY_EXPOSURE[place.defaultActivity];
  let journeyDays: number | null = null;
  if (journey) {
    const acts = journey.activities.length ? journey.activities : [place.defaultActivity];
    activityExposure = Math.max(...acts.map(a => ACTIVITY_EXPOSURE[a] ?? 0.4));
    journeyDays = dayDiff(journey.startDate, now);
    const top = acts.reduce((a, b) => ((ACTIVITY_EXPOSURE[a] ?? 0) >= (ACTIVITY_EXPOSURE[b] ?? 0) ? a : b));
    factors.push({ key: 'journey_context', label: 'Journey context', value: round(activityExposure), status: 'derived',
      detail: `${journey.label} — most exposed planned activity: ${top}` });
  } else {
    factors.push({ key: 'journey_context', label: 'Journey context', value: round(activityExposure), status: 'default',
      detail: `No journey for this place — assumed a typical ${place.defaultActivity} visit` });
  }

  // 2. Tourist exposure — how much the traveller is out in current conditions
  const inProgress = journey ? dayDiff(journey.startDate, now) <= 0 && dayDiff(journey.endDate, now) >= 0 : false;
  const soon = journeyDays !== null && journeyDays > 0 && journeyDays <= 7;
  const exposure = round(activityExposure * (inProgress ? 1 : soon ? 0.8 : 0.6));
  factors.push({
    key: 'tourist_exposure', label: 'Tourist exposure', value: exposure, status: journey ? 'derived' : 'default',
    detail: inProgress ? 'Journey in progress — current conditions apply directly'
      : soon ? `Journey starts in ${journeyDays} day${journeyDays === 1 ? '' : 's'}`
      : journey ? 'Journey is more than a week away — conditions may change' : 'No journey — generic visitor exposure',
  });

  // 3. Location risk — configured zones + configured terrain
  const zoneScore = zones.length ? Math.max(...zones.map(z => ZONE_SEVERITY[z.severity])) : 0;
  const terrainScore = place.terrain.length ? Math.max(...place.terrain.map(t => TERRAIN_RISK[t])) : 0;
  const worstZone = zones.slice().sort((a, b) => ZONE_SEVERITY[b.severity] - ZONE_SEVERITY[a.severity])[0];
  factors.push({
    key: 'location_risk', label: 'Location risk', value: round(Math.max(zoneScore, terrainScore)),
    status: zones.length ? 'live' : 'configured',
    detail: [
      worstZone ? `${worstZone.name} (${worstZone.hazard_type}, ${worstZone.severity.toLowerCase()}) ${Math.round(worstZone.distance_m)} m away` : 'No configured risk zones nearby',
      place.terrain.length ? `terrain: ${place.terrain.join(', ')}` : 'no notable terrain hazards configured',
    ].join(' · '),
  });

  // 4. Time context
  if (o && o.isDay !== null) {
    const toSunset = o.sunset ? (o.sunset.getTime() - now.getTime()) / 60_000 : null;
    const lastLight = o.isDay && toSunset !== null && toSunset > 0 && toSunset <= 60;
    factors.push({ key: 'time_context', label: 'Time context', value: o.isDay ? (lastLight ? 0.35 : 0.1) : 0.6, status: 'live',
      detail: o.isDay ? (lastLight ? `Daylight ends in ${Math.round(toSunset!)} min` : 'Daylight') : 'Night-time at the destination' });
  } else {
    factors.push({ key: 'time_context', label: 'Time context', value: null, status: 'unavailable', detail: 'Local daylight unknown' });
  }

  // 5. Weather and environment (general conditions beyond hazards)
  if (o) {
    const vis = o.visibilityM;
    const visScore = vis === null ? 0 : vis < 200 ? 0.9 : vis < 1000 ? 0.6 : vis < 4000 ? 0.25 : 0;
    const wet = (o.rainRateMmH ?? 0) > 0 ? 0.2 : 0;
    const t = o.temperatureC;
    const thermal = t === null ? 0 : t >= 30 || t <= 0 ? 0.3 : 0;
    const v = Math.max(visScore, wet, thermal);
    const parts = [describeWeather(o.weatherCode), t !== null ? `${t} °C` : null,
      vis !== null && vis < 4000 ? `visibility ${vis < 1000 ? `${Math.round(vis)} m (fog)` : `${(vis / 1000).toFixed(1)} km`}` : null].filter(Boolean);
    factors.push({ key: 'weather_environment', label: 'Weather & environment', value: round(v), status: 'live', detail: parts.join(' · ') });
  } else {
    factors.push({ key: 'weather_environment', label: 'Weather & environment', value: null, status: 'unavailable', detail: 'Weather provider unavailable' });
  }

  // 6. Accessibility and remoteness (configured setting of the landmark)
  const remote = SETTING_REMOTENESS[place.setting];
  factors.push({ key: 'accessibility_remoteness', label: 'Accessibility & remoteness', value: remote, status: 'configured',
    detail: `${place.setting[0].toUpperCase()}${place.setting.slice(1)} setting (configured classification)` });

  // 7. Historical incidents (TravelSphere reports within 25 km, past 12 months)
  factors.push(incidentCount === null
    ? { key: 'historical_incidents', label: 'Historical incidents', value: null, status: 'unavailable', detail: 'Incident records unavailable' }
    : { key: 'historical_incidents', label: 'Historical incidents', value: round(Math.min(1, incidentCount / 10)), status: 'live',
        detail: incidentCount === 0 ? 'No incidents reported to TravelSphere within 25 km in the past year (small dataset)'
          : `${incidentCount} incident${incidentCount === 1 ? '' : 's'} reported within 25 km in the past year` });

  // keep spec order
  const ORDER: FactorKey[] = ['hazard_intensity', 'tourist_exposure', 'location_risk', 'time_context',
    'weather_environment', 'accessibility_remoteness', 'historical_incidents', 'journey_context'];
  factors.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  const factorsAvailable = factors.filter(f => AVAILABLE.includes(f.status)).length;
  const val = (k: FactorKey) => factors.find(f => f.key === k)!.value ?? 0;

  // No live conditions → no assessment (never report "Low" on missing data)
  if (!o || !hazard) {
    return {
      placeId: place.id, riskLevel: null, dataStatus: 'UNAVAILABLE', factors, factorsAvailable,
      reasons: ['Current conditions are unavailable, so no risk level is given'],
      recommendedAction: 'Check official local weather and safety services before heading out.',
      observedAt: null, observationAgeMin: null, weather: null, modelVersion: MODEL_VERSION, uncertainty: 'Not calibrated',
    };
  }

  // ---------------------------------------------------------------- level rules
  const outdoor = exposure >= 0.45;
  const drivers = hazard.drivers;
  const top = drivers[0]?.text ?? 'Hazardous weather';
  const has = (kind: string) => drivers.some(d => d.kind === kind);
  const reasons: string[] = [];
  let level: RiskLevel = 'LOW';
  const raise = (l: RiskLevel, why: string) => {
    const rank = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };
    if (rank[l] > rank[level]) level = l;
    if (!reasons.includes(why)) reasons.push(why);
  };

  if (has('thunderstorm') && outdoor) raise('HIGH', `${drivers.find(d => d.kind === 'thunderstorm')!.text} with outdoor exposure`);
  if (hazard.value >= 0.75 && outdoor) raise('HIGH', `${top} during outdoor activity`);
  if (worstZone?.severity === 'HIGH') raise('HIGH', `Inside or near a high-severity ${worstZone.hazard_type} zone (${worstZone.name})`);
  if (hazard.value >= 0.5 && terrainScore >= 0.25 && outdoor) raise('HIGH', `${top} near ${place.terrain.join('/')} terrain`);

  if (hazard.value >= 0.45) raise('MODERATE', top);
  if (val('weather_environment') >= 0.6) raise('MODERATE', 'Low visibility (fog)');
  if (val('time_context') >= 0.6 && remote >= 0.5 && outdoor) raise('MODERATE', 'After dark in a remote area');
  if (worstZone?.severity === 'MODERATE') raise('MODERATE', `Near a ${worstZone.hazard_type} zone (${worstZone.name})`);
  if (val('historical_incidents') >= 0.5) raise('MODERATE', 'Several recent incidents reported nearby');
  if (hazard.value >= 0.3 && terrainScore >= 0.25) raise('MODERATE', `${top} near ${place.terrain.join('/')} terrain`);

  if (!reasons.length) reasons.push('No hazardous conditions detected for this place right now');

  const action = recommend(level, drivers.map(d => d.kind), val('weather_environment') >= 0.6,
    val('time_context') >= 0.6 && remote >= 0.5, worstZone);

  const dataStatus: DataStatus = stale ? 'STALE' : factorsAvailable < 8 ? 'PARTIAL' : 'CURRENT';
  if (stale) reasons.push(`Conditions were last observed ${age} minutes ago`);

  return {
    placeId: place.id,
    riskLevel: level,
    dataStatus,
    factors,
    factorsAvailable,
    reasons,
    recommendedAction: action,
    observedAt: o.observedAt.toISOString(),
    observationAgeMin: age,
    weather: { summary: describeWeather(o.weatherCode), temperatureC: o.temperatureC, rainRateMmH: o.rainRateMmH, windGustMs: o.windGustMs },
    modelVersion: MODEL_VERSION,
    uncertainty: 'Not calibrated — rule baseline, no validated incident data yet',
  };
}

function recommend(level: RiskLevel, kinds: string[], fog: boolean, nightRemote: boolean, zone?: ZoneHit): string {
  if (zone && zone.severity !== 'LOW') return `Avoid the ${zone.name} area and follow local authority guidance.`;
  if (kinds.includes('thunderstorm')) return 'Postpone exposed outdoor plans and stay near shelter until the storm passes.';
  if (kinds.includes('rain') && level !== 'LOW') return 'Avoid riverside, cliff-edge and trekking routes; allow extra travel time.';
  if (kinds.includes('wind')) return 'Stay back from cliff edges and coastal viewpoints; secure loose items.';
  if (kinds.includes('ice') || kinds.includes('snow')) return 'Expect slippery surfaces; wear suitable footwear and check road conditions.';
  if (kinds.includes('heat')) return 'Plan outdoor visits for early morning, carry water and rest in shade.';
  if (kinds.includes('cold')) return 'Dress in layers and limit time outdoors.';
  if (fog) return 'Visibility is low — avoid driving remote roads and keep to marked paths.';
  if (nightRemote) return 'Avoid remote outdoor areas after dark; share your plans with someone.';
  return 'No elevated risk from current conditions. Check again before heading out.';
}
