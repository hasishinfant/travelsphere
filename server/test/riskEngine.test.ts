import { describe, expect, it } from 'vitest';
import { assess, hazardFrom, type JourneyCtx } from '../src/services/riskEngine.js';
import { parseOpenMeteo, type Observation } from '../src/services/weather.js';
import { getPlace } from '../src/data/places.js';

const NOW = new Date('2026-11-04T12:00:00Z');
const obs = (o: Partial<Observation> = {}): Observation => ({
  placeId: 'x', observedAt: new Date(NOW.getTime() - 10 * 60_000), source: 'open-meteo',
  temperatureC: 15, rainRateMmH: 0, next6hMaxRainMmH: 0, windGustMs: 4, next6hMaxGustMs: 5,
  weatherCode: 1, isDay: true, visibilityM: 30_000, sunset: new Date('2026-11-04T17:00:00Z'), timezone: 'UTC', ...o,
});
const trek = (startOffsetDays = 0): JourneyCtx => {
  const d = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  return { startDate: d(startOffsetDays), endDate: d(startOffsetDays + 4), activities: ['trekking', 'sightseeing'], label: 'Test journey' };
};
const base = { zones: [], incidentCount: 0, journey: null, now: NOW };
const paris = getPlace('paris')!;
const iceland = getPlace('iceland')!;
const santorini = getPlace('santorini')!;

describe('8-factor rule baseline', () => {
  it('returns all eight factors in the specified order', () => {
    const a = assess({ ...base, place: paris, observation: obs() });
    expect(a.factors.map(f => f.key)).toEqual(['hazard_intensity', 'tourist_exposure', 'location_risk', 'time_context',
      'weather_environment', 'accessibility_remoteness', 'historical_incidents', 'journey_context']);
  });

  it('calm day in a city without a journey → LOW, 6/8 factors backed by data', () => {
    const a = assess({ ...base, place: paris, observation: obs() });
    expect(a.riskLevel).toBe('LOW');
    expect(a.factorsAvailable).toBe(6); // exposure + journey are generic defaults
    expect(a.dataStatus).toBe('PARTIAL');
  });

  it('a journey for the place makes all 8 factors available', () => {
    const a = assess({ ...base, place: paris, observation: obs(), journey: trek(0) });
    expect(a.factorsAvailable).toBe(8);
    expect(a.dataStatus).toBe('CURRENT');
  });

  it('same heavy rain: generic visitor → MODERATE, traveller trekking now → HIGH (journey-aware)', () => {
    const rain = obs({ rainRateMmH: 10, weatherCode: 65 });
    const visitor = assess({ ...base, place: paris, observation: rain });
    const trekker = assess({ ...base, place: paris, observation: rain, journey: trek(0) });
    expect(visitor.riskLevel).toBe('MODERATE');
    expect(trekker.riskLevel).toBe('HIGH');
    expect(trekker.recommendedAction).toMatch(/trekking routes/);
  });

  it('forecast heavy rain within 6 hours counts as a hazard', () => {
    const h = hazardFrom(obs({ rainRateMmH: 0, next6hMaxRainMmH: 9 }));
    expect(h.value).toBe(0.75);
    expect(h.drivers[0].text).toMatch(/within 6 hours/);
  });

  it('thunderstorm with outdoor exposure → HIGH', () => {
    const a = assess({ ...base, place: iceland, observation: obs({ weatherCode: 95 }), journey: trek(0) });
    expect(a.riskLevel).toBe('HIGH');
    expect(a.recommendedAction).toMatch(/shelter/);
  });

  it('gale-force gusts near cliffs while sightseeing → HIGH', () => {
    const a = assess({ ...base, place: santorini, observation: obs({ windGustMs: 18 }),
      journey: { ...trek(0), activities: ['sightseeing'] } });
    expect(a.riskLevel).toBe('HIGH');
    expect(a.recommendedAction).toMatch(/cliff edges/);
  });

  it('strong-breeze gusts near cliffs name the cause (regression: headline was "undefined")', () => {
    const a = assess({ ...base, place: santorini, observation: obs({ windGustMs: 12.4 }) });
    expect(a.riskLevel).toBe('MODERATE');
    expect(a.reasons[0]).toBe('Strong gusts (12.4 m/s) near cliffs/coastal/volcanic terrain');
    expect(a.reasons.join(' ')).not.toMatch(/undefined/);
  });

  it('night in a remote area with outdoor plans → MODERATE', () => {
    const a = assess({ ...base, place: iceland, observation: obs({ isDay: false }) });
    expect(a.riskLevel).toBe('MODERATE');
    expect(a.reasons).toContain('After dark in a remote area');
  });

  it('fog → MODERATE', () => {
    const a = assess({ ...base, place: paris, observation: obs({ visibilityM: 500, weatherCode: 45 }) });
    expect(a.riskLevel).toBe('MODERATE');
  });

  it('a configured high-severity risk zone → HIGH with an avoidance action', () => {
    const a = assess({ ...base, place: paris, observation: obs(),
      zones: [{ name: 'Seine flood plain', hazard_type: 'flood', severity: 'HIGH', distance_m: 120 }] });
    expect(a.riskLevel).toBe('HIGH');
    expect(a.recommendedAction).toMatch(/Seine flood plain/);
  });

  it('old observations are flagged STALE, not presented as live', () => {
    const a = assess({ ...base, place: paris, observation: obs({ observedAt: new Date(NOW.getTime() - 3 * 3600_000) }) });
    expect(a.dataStatus).toBe('STALE');
    expect(a.reasons.at(-1)).toMatch(/180 minutes ago/);
  });

  it('no weather → no risk level at all (never "Low" on missing data)', () => {
    const a = assess({ ...base, place: paris, observation: null });
    expect(a.riskLevel).toBeNull();
    expect(a.dataStatus).toBe('UNAVAILABLE');
    expect(a.factors.find(f => f.key === 'hazard_intensity')!.status).toBe('unavailable');
  });

  it('never produces CRITICAL (reserved for official warnings, which are not integrated)', () => {
    const extreme = obs({ rainRateMmH: 80, windGustMs: 30, weatherCode: 99, temperatureC: 42 });
    const a = assess({ ...base, place: iceland, observation: extreme, journey: trek(0) });
    expect(a.riskLevel).toBe('HIGH');
  });
});

describe('Open-Meteo parsing and validation', () => {
  const body = {
    utc_offset_seconds: 3600, timezone: 'Europe/Paris',
    current: { time: '2026-01-10T12:45', interval: 900, temperature_2m: 6.6, precipitation: 0.5, weather_code: 61,
      wind_gusts_10m: 8.9, is_day: 1, visibility: 39120 },
    hourly: { precipitation: [0.2, 3.1, 1.0], wind_gusts_10m: [9, 12.5, 8] },
    daily: { sunset: ['2026-01-10T17:20'] },
  };

  it('converts local time to UTC and the 15-min sum to an hourly rate', () => {
    const o = parseOpenMeteo('paris', body)!;
    expect(o.observedAt.toISOString()).toBe('2026-01-10T11:45:00.000Z');
    expect(o.rainRateMmH).toBe(2);
    expect(o.next6hMaxRainMmH).toBe(3.1);
    expect(o.next6hMaxGustMs).toBe(12.5);
  });

  it('drops physically impossible readings', () => {
    const o = parseOpenMeteo('paris', { ...body, current: { ...body.current, temperature_2m: 300, wind_gusts_10m: -4 } })!;
    expect(o.temperatureC).toBeNull();
    expect(o.windGustMs).toBeNull();
  });

  it('rejects responses without a valid timestamp', () => {
    expect(parseOpenMeteo('paris', { current: { temperature_2m: 5 } })).toBeNull();
  });
});
