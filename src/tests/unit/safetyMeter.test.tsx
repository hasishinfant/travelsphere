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
  it('shows confidence in the data next to the level, not as part of it', () => {
    render(<SafetyMeter placeId="kyoto" conditions={ready({ ...base, confidence: { score: 86, level: 'high',
      explanation: '8 of 8 applicable factors have data', weakest: 'precision', components: {} } })} />);
    expect(screen.getByText('Low risk')).toBeInTheDocument();
    expect(screen.getByText('high confidence')).toBeInTheDocument();
    expect(screen.getByLabelText(/high confidence in the data \(86 of 100\)/)).toBeInTheDocument();
  });
  it('falls back to the factor count when the fallback engine gives no confidence', () => {
    render(<SafetyMeter placeId="kyoto" conditions={ready({ ...base, factors_available: 6, confidence: null })} />);
    expect(screen.getByText('6/8 data')).toBeInTheDocument();
  });
});
