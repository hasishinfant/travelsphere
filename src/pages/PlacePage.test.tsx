// PlacePage with assessments from before and after the hazard climatologies.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import type { PlaceAssessment } from '@/services/conditions';

const fetchAssessment = vi.fn();
vi.mock('@/services/apiClient', async importActual => ({
  ...(await importActual<typeof import('@/services/apiClient')>()),
  ensureSession: vi.fn(async () => true),
}));
vi.mock('@/services/conditions', async importActual => ({
  ...(await importActual<typeof import('@/services/conditions')>()),
  fetchAssessment: (id: string) => fetchAssessment(id),
}));

import PlacePage from './PlacePage';

// An assessment as the API returned it before hazard_outlook existed: the property is absent, not null
const legacy = (): Omit<PlaceAssessment, 'hazard_outlook'> => ({
  place_id: 'paris', risk_level: 'LOW', data_status: 'CURRENT', factors_available: 6, headline: 'Calm',
  observed_at: new Date().toISOString(), weather: null,
  factors: [{ key: 'weather_severity', label: 'Weather severity', value: 0.1, status: 'live', detail: 'Calm' }],
  reasons: ['Calm conditions'], recommended_action: 'Normal precautions', observation_age_min: 5,
  model_version: 'scoring-v1 (risk-engine-1.0.0)', uncertainty: 'Rule-based', notice: 'Travel safety information only.',
});

const renderPlace = () => render(
  <MemoryRouter initialEntries={['/places/paris']}>
    <Routes><Route path="/places/:placeId" element={<PlacePage />} /></Routes>
  </MemoryRouter>,
);

describe('PlacePage hazard outlook', () => {
  beforeEach(() => fetchAssessment.mockReset());

  it('renders an older assessment without hazard_outlook and shows no hazard panel', async () => {
    const a = legacy();
    expect('hazard_outlook' in a).toBe(false);
    fetchAssessment.mockResolvedValue(a);
    renderPlace();
    expect(await screen.findByText('Low risk')).toBeInTheDocument();
    expect(screen.getByText('Weather severity')).toBeInTheDocument();
    expect(screen.queryByText('Seasonal hazards')).not.toBeInTheDocument();
  });

  it('shows the hazard panel when the assessment has an outlook', async () => {
    fetchAssessment.mockResolvedValue({ ...legacy(), hazard_outlook: {
      cyclone: null, unavailable: { cyclone: "outside the cyclone climatology's area" },
      flood: { p_period: 0.0063, period_days: 7, scope: 'destination', p_week: 0.0063, annual_rate: 0.57,
        expected_weeks_per_year: 0.56, peak_week_start: '29 Jan', p_peak_week: 0.035,
        monthly_p_week: Array(12).fill(0.005), years: [1985, 2021], definition: 'x' },
    } });
    renderPlace();
    expect(await screen.findByText('Seasonal hazards')).toBeInTheDocument();
    expect(screen.getByText('0.6%')).toBeInTheDocument();
    expect(screen.getByText(/Outside the area this model covers/)).toBeInTheDocument();
  });
});
