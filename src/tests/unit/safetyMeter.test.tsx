import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import SafetyMeter from '@/components/ui/SafetyMeter';
import type { PlaceConditions } from '@/services/conditions';

const base: PlaceConditions = {
  place_id: 'kyoto', risk_level: 'LOW', data_status: 'CURRENT', factors_available: 8, factors_total: 8,
  headline: 'Low risk from current conditions', observed_at: null,
  weather: { summary: 'Clear sky', temperatureC: 12, rainRateMmH: 0, windGustMs: 3 },
};
const ready = (c: PlaceConditions) => ({ state: 'ready', byPlace: { kyoto: c } }) as any;

describe('SafetyMeter (scoring-v2)', () => {
  it('shows how sure we are next to the level, never the word "confidence"', () => {
    render(<SafetyMeter placeId="kyoto" conditions={ready({ ...base, confidence: { score: 86, level: 'high',
      explanation: '8 of 8 applicable factors have data', weakest: 'precision', components: {} } })} />);
    expect(screen.getByText('Low risk')).toBeInTheDocument();
    expect(screen.getByText('very sure')).toBeInTheDocument();
    expect(screen.getByLabelText(/Very sure about this rating \(data quality 86 of 100\)/)).toBeInTheDocument();
    expect(screen.queryByText(/confidence/i)).toBeNull();
  });
  it('falls back to the factor count when the fallback engine gives no confidence', () => {
    render(<SafetyMeter placeId="kyoto" conditions={ready({ ...base, factors_available: 6, confidence: null })} />);
    expect(screen.getByText('6/8 data')).toBeInTheDocument();
  });
});


import { certaintyMessage } from '@/services/conditions';
describe('certaintyMessage: what the risk level and certainty mean together', () => {
  it('high risk + very sure says the danger is real (not "safe to go")', () => {
    const m = certaintyMessage('HIGH', 'high');
    expect(m.title).toBe('We are very sure about this high risk rating');
    expect(m.body).toMatch(/the danger is real/);
    expect(m.body).not.toMatch(/safe/i);
  });
  it('low risk + very sure still says to check again', () => {
    expect(certaintyMessage('LOW', 'high').body).toMatch(/check again before you go/);
  });
  it('fairly sure names what is missing and says the rating could change', () => {
    const m = certaintyMessage('MODERATE', 'medium', ['Access to emergency care']);
    expect(m.title).toMatch(/could change/);
    expect(m.body).toMatch(/missing: Access to emergency care/);
  });
  it('not sure tells the traveller not to rely on the rating', () => {
    const m = certaintyMessage('LOW', 'low', ['Weather severity']);
    expect(m.title).toBe('Not sure — do not rely on this rating');
    expect(m.body).toMatch(/official weather and civil-protection services/);
  });
});
