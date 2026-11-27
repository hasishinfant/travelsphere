// Turns live conditions (time of day at the panorama's location + the current Open-Meteo weather the risk engine
// already fetched) into visual settings for the 360° viewer. The photo itself is not live: these are SIMULATED
// effects over a recorded image, and the viewer says so.

export interface LiveWeather {
  summary: string;               // WMO description from the assessment, e.g. "Light rain", "Fog", "Thunderstorm"
  temperatureC: number | null;
  rainRateMmH: number | null;
  windGustMs: number | null;
}

export type Light = 'day' | 'golden' | 'twilight' | 'night';
export type Precip = 'none' | 'drizzle' | 'rain' | 'heavy' | 'snow' | 'storm';

export interface SceneLook {
  light: Light;
  sunElevation: number;          // degrees
  tint: [number, number, number]; // multiplied with the photo (0–1 per channel)
  precip: Precip;
  particles: number;             // how many drops / flakes
  fog: number;                   // 0 none … 1 thick (fraction of the photo washed out)
  windMs: number;                // drives the slant and drift of particles
  lightning: boolean;
  overcast: boolean;
}

const rad = Math.PI / 180;

/** Solar elevation in degrees (NOAA "General Solar Position" approximation; a few minutes of accuracy). */
export function solarElevation(lat: number, lon: number, when: Date): number {
  const start = Date.UTC(when.getUTCFullYear(), 0, 1);
  const day = Math.floor((when.getTime() - start) / 86_400_000) + 1;
  const hour = when.getUTCHours() + when.getUTCMinutes() / 60 + when.getUTCSeconds() / 3600;
  const g = (2 * Math.PI / 365) * (day - 1 + (hour - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g)
    - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const trueSolarMin = hour * 60 + eqTime + 4 * lon;
  const ha = (trueSolarMin / 4 - 180) * rad;
  const cosZen = Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(ha);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cosZen))) / rad;
}

export function lightFor(elevation: number): Light {
  if (elevation < -6) return 'night';         // below civil twilight
  if (elevation < 0) return 'twilight';
  if (elevation < 8) return 'golden';
  return 'day';
}

const TINT: Record<Light, [number, number, number]> = {
  day: [1, 1, 1],
  golden: [1, 0.86, 0.7],
  twilight: [0.62, 0.56, 0.74],
  night: [0.34, 0.38, 0.54],
};

export function precipFor(w: LiveWeather | null): Precip {
  if (!w) return 'none';
  const s = w.summary.toLowerCase();
  const rate = w.rainRateMmH ?? 0;
  if (s.includes('thunder')) return 'storm';
  if (s.includes('snow')) return 'snow';
  if (rate > 7.6 || s.includes('heavy rain') || s.includes('violent')) return 'heavy';   // AMS heavy rain
  if (rate >= 2.5 || /\brain\b|shower/.test(s)) return 'rain';
  if (rate > 0 || s.includes('drizzle')) return 'drizzle';
  return 'none';
}

const PARTICLES: Record<Precip, number> = { none: 0, drizzle: 700, rain: 1600, heavy: 3200, storm: 3200, snow: 1400 };

export function lookFor(lat: number, lon: number, when: Date, w: LiveWeather | null): SceneLook {
  const sunElevation = solarElevation(lat, lon, when);
  const light = lightFor(sunElevation);
  const precip = precipFor(w);
  const s = (w?.summary ?? '').toLowerCase();
  const overcast = /overcast|cloud/.test(s) || precip !== 'none';
  // A grey haze stands in for the flat, low-contrast light of rain and cloud (it also mutes the sunny blue sky)
  const fog = s.includes('dense fog') || s.includes('freezing fog') ? 0.6 : s.includes('fog') ? 0.4
    : precip === 'heavy' || precip === 'storm' ? 0.38 : precip === 'rain' || precip === 'snow' ? 0.28
    : precip === 'drizzle' ? 0.2 : overcast ? 0.14 : 0;
  const base = TINT[light];
  // Rain and cloud cut the light; not applied again at night (already dark)
  const dim = light === 'night' ? 1 : precip === 'heavy' || precip === 'storm' ? 0.62 : precip !== 'none' ? 0.72
    : overcast ? 0.85 : 1;
  const tint = base.map((c, i) => Math.min(1, c * dim * (overcast && i === 2 ? 1.04 : 1))) as [number, number, number];
  return { light, sunElevation, tint, precip, particles: PARTICLES[precip], fog, windMs: w?.windGustMs ?? 0,
    lightning: precip === 'storm', overcast };
}

export function describeLook(look: SceneLook, w: LiveWeather | null): string {
  const light = { day: 'Daylight', golden: 'Low sun', twilight: 'Twilight', night: 'Night' }[look.light];
  const parts = [light];
  if (w) {
    parts.push(w.summary);
    if (w.temperatureC !== null) parts.push(`${Math.round(w.temperatureC)} °C`);
    if (w.windGustMs !== null && w.windGustMs >= 8) parts.push(`gusts ${Math.round(w.windGustMs)} m/s`);
  }
  return parts.join(' · ');
}
