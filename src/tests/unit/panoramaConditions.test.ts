import { describe, expect, it } from 'vitest';
import { describeLook, lightFor, lookFor, precipFor, solarElevation } from '@/components/ui/panoramaConditions';
import { PANORAMAS } from '@/data/panoramas';

describe('360° live conditions', () => {
  it('computes the sun: high at solar noon, below the horizon at midnight', () => {
    // Santorini, 21 June: solar noon ≈ 10:20 UTC
    expect(solarElevation(36.43, 25.42, new Date('2026-06-21T10:20:00Z'))).toBeGreaterThan(70);
    expect(solarElevation(36.43, 25.42, new Date('2026-06-21T22:20:00Z'))).toBeLessThan(-20);
    // Reykjavík area in December barely clears the horizon at noon
    expect(solarElevation(64.33, -20.12, new Date('2026-12-21T13:20:00Z'))).toBeLessThan(5);
  });
  it('maps sun elevation to light', () => {
    expect([lightFor(30), lightFor(4), lightFor(-3), lightFor(-12)]).toEqual(['day', 'golden', 'twilight', 'night']);
  });
  it('maps the live weather to effects (AMS heavy rain > 7.6 mm/h)', () => {
    const w = (summary: string, rain = 0) => ({ summary, temperatureC: 10, rainRateMmH: rain, windGustMs: 5 });
    expect(precipFor(w('Clear sky'))).toBe('none');
    expect(precipFor(w('Light drizzle', 0.3))).toBe('drizzle');
    expect(precipFor(w('Rain', 4))).toBe('rain');
    expect(precipFor(w('Overcast', 9))).toBe('heavy');
    expect(precipFor(w('Snow'))).toBe('snow');
    expect(precipFor(w('Thunderstorm'))).toBe('storm');
    expect(precipFor(null)).toBe('none');
    const fog = lookFor(51.5, -0.12, new Date('2026-06-21T12:00:00Z'), w('Dense fog'));
    expect(fog.fog).toBeGreaterThan(0.5);
    const storm = lookFor(51.5, -0.12, new Date('2026-06-21T12:00:00Z'), w('Thunderstorm'));
    expect(storm.lightning && storm.particles > 0).toBe(true);
  });
  it('describes the scene in words', () => {
    const night = lookFor(36.43, 25.42, new Date('2026-06-21T22:20:00Z'),
      { summary: 'Light rain', temperatureC: 19.6, rainRateMmH: 0.8, windGustMs: 15.4 });
    expect(describeLook(night, { summary: 'Light rain', temperatureC: 19.6, rainRateMmH: 0.8, windGustMs: 15.4 }))
      .toBe('Night · Light rain · 20 °C · gusts 15 m/s');
  });
  it('every panorama carries its capture date, place and timezone', () => {
    for (const [id, p] of Object.entries(PANORAMAS)) {
      expect(p.taken, id).toMatch(/^\d{4}-\d{2}(-\d{2})?$/);
      expect(Math.abs(p.lat), id).toBeLessThanOrEqual(90);
      expect(() => new Intl.DateTimeFormat('en', { timeZone: p.timezone }), id).not.toThrow();
    }
    expect(PANORAMAS.iceland.caption).toMatch(/Gullfoss/);
    expect(PANORAMAS.iceland.note).toMatch(/Seljalandsfoss/);
  });
});
