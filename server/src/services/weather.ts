// Environmental observations from Open-Meteo (keyless). Values are validated, timestamped,
// stored in environment_observations and cached briefly. When the provider fails, the most
// recent stored observation is returned and its age decides CURRENT vs STALE.
import type { Db } from '../db.js';
import type { PlaceProfile } from '../data/places.js';

export interface Observation {
  placeId: string;
  observedAt: Date;
  source: 'open-meteo';
  temperatureC: number | null;
  rainRateMmH: number | null;        // current rate (derived from the 15-min interval sum)
  next6hMaxRainMmH: number | null;   // forecast, max hourly precipitation over the next 6 h
  windGustMs: number | null;
  next6hMaxGustMs: number | null;
  weatherCode: number | null;        // WMO 4677 code
  isDay: boolean | null;
  visibilityM: number | null;
  sunset: Date | null;
  timezone: string | null;
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const STALE_AFTER_MIN = 60;
const CACHE_MS = 10 * 60_000;

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;

/** Open-Meteo returns local wall-clock times plus the UTC offset; convert to a real instant. */
const localToUtc = (local: unknown, offsetSec: number): Date | null => {
  if (typeof local !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local)) return null;
  const d = new Date(`${local}:00Z`);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() - offsetSec * 1000);
};

export function parseOpenMeteo(placeId: string, body: any): Observation | null {
  const c = body?.current;
  const offset = typeof body?.utc_offset_seconds === 'number' ? body.utc_offset_seconds : 0;
  const observedAt = localToUtc(c?.time, offset);
  if (!c || !observedAt) return null;
  // Reject observations from the future (clock/timezone errors) by more than 15 minutes
  if (observedAt.getTime() > Date.now() + 15 * 60_000) return null;

  const interval = num(c.interval, 60, 3600) ?? 900;
  const precip = num(c.precipitation, 0, 500);
  const hourlyRain: number[] = Array.isArray(body?.hourly?.precipitation)
    ? body.hourly.precipitation.map((v: unknown) => num(v, 0, 500)).filter((v: number | null): v is number => v !== null)
    : [];
  const hourlyGust: number[] = Array.isArray(body?.hourly?.wind_gusts_10m)
    ? body.hourly.wind_gusts_10m.map((v: unknown) => num(v, 0, 120)).filter((v: number | null): v is number => v !== null)
    : [];

  return {
    placeId,
    observedAt,
    source: 'open-meteo',
    temperatureC: num(c.temperature_2m, -90, 65),
    rainRateMmH: precip === null ? null : Math.round(precip * (3600 / interval) * 10) / 10,
    next6hMaxRainMmH: hourlyRain.length ? Math.max(...hourlyRain) : null,
    windGustMs: num(c.wind_gusts_10m, 0, 120),
    next6hMaxGustMs: hourlyGust.length ? Math.max(...hourlyGust) : null,
    weatherCode: num(c.weather_code, 0, 99),
    isDay: c.is_day === 1 ? true : c.is_day === 0 ? false : null,
    visibilityM: num(c.visibility, 0, 200_000),
    sunset: localToUtc(body?.daily?.sunset?.[0], offset),
    timezone: typeof body?.timezone === 'string' ? body.timezone : null,
  };
}

export class WeatherService {
  private cache: { at: number; obs: Map<string, Observation> } | null = null;

  constructor(private db: Db, private fetcher: FetchLike = globalThis.fetch as unknown as FetchLike) {}

  private url(places: PlaceProfile[]) {
    const p = new URLSearchParams({
      latitude: places.map(x => x.lat).join(','),
      longitude: places.map(x => x.lng).join(','),
      current: 'temperature_2m,precipitation,weather_code,wind_gusts_10m,is_day,visibility',
      hourly: 'precipitation,wind_gusts_10m',
      daily: 'sunset',
      forecast_hours: '6',
      forecast_days: '1',
      timezone: 'auto',
      wind_speed_unit: 'ms',
    });
    return `https://api.open-meteo.com/v1/forecast?${p}`;
  }

  /** Latest observation per place: live when possible, else last stored. Missing → absent from the map. */
  async observe(places: PlaceProfile[]): Promise<Map<string, Observation>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS && places.every(p => this.cache!.obs.has(p.id))) {
      return this.cache.obs;
    }
    const live = new Map<string, Observation>();
    try {
      const res = await this.fetcher(this.url(places));
      if (!res.ok) throw new Error(`open-meteo ${res.status}`);
      const body = await res.json();
      const list = Array.isArray(body) ? body : [body];
      places.forEach((p, i) => {
        const o = parseOpenMeteo(p.id, list[i]);
        if (o) live.set(p.id, o);
      });
      await this.store([...live.values()], places);
      this.cache = { at: Date.now(), obs: live };
    } catch (err) {
      console.warn('[weather] provider unavailable:', (err as Error).message);
    }
    // Fill gaps from the database (marked by age later)
    const missing = places.filter(p => !live.has(p.id));
    if (missing.length) {
      for (const o of await this.lastStored(missing.map(p => p.id))) live.set(o.placeId, o);
    }
    return live;
  }

  private async store(obs: Observation[], places: PlaceProfile[]) {
    for (const o of obs) {
      const p = places.find(x => x.id === o.placeId)!;
      await this.db.query(
        `insert into public.environment_observations
           (place_id, latitude, longitude, observed_at, source, rainfall_mm_h, temperature_c, wind_speed_ms, conditions, raw)
         select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
         where not exists (select 1 from public.environment_observations where place_id = $1 and observed_at = $4)`,
        [o.placeId, p.lat, p.lng, o.observedAt, o.source, o.rainRateMmH, o.temperatureC, o.windGustMs,
          o.weatherCode === null ? null : String(o.weatherCode), JSON.stringify(o)],
      );
    }
  }

  private async lastStored(placeIds: string[]): Promise<Observation[]> {
    const { rows } = await this.db.query(
      `select distinct on (place_id) raw from public.environment_observations
       where place_id = any($1) order by place_id, observed_at desc`,
      [placeIds],
    );
    return rows.map(r => ({
      ...r.raw,
      observedAt: new Date(r.raw.observedAt),
      sunset: r.raw.sunset ? new Date(r.raw.sunset) : null,
    }));
  }
}

export const ageMinutes = (o: Observation, now = new Date()) => Math.round((now.getTime() - o.observedAt.getTime()) / 60_000);

const WMO: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Heavy freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers',
  82: 'Violent rain showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm',
  96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail',
};
export const describeWeather = (code: number | null) => (code === null ? 'Unknown' : WMO[code] || `Code ${code}`);
