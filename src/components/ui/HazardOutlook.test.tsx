import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom';
import HazardOutlook, { formatChance } from './HazardOutlook';
import type { HazardClimate } from '@/services/conditions';

const climate = (over: Partial<HazardClimate> = {}): HazardClimate => ({
  p_period: 0.00348, period_days: 7, scope: 'destination', p_week: 0.00348, annual_rate: 0.33,
  peak_week_start: '20 Aug', p_peak_week: 0.028,
  monthly_p_week: [0, 0, 0, 0, 0.001, 0.004, 0.012, 0.028, 0.025, 0.01, 0.003, 0], years: [1980, 2026],
  definition: 'tropical storm or stronger (≥ 34 kt) passing within 100 km', ...over,
});
const NOV = new Date(2026, 10, 23);

describe('HazardOutlook', () => {
  it('shows the 7-day chance, yearly rate, peak and source for each hazard', () => {
    render(<HazardOutlook now={NOV} outlook={{ cyclone: climate(),
      flood: climate({ p_period: 0.0063, annual_rate: 0.57, expected_weeks_per_year: 0.56, peak_week_start: '29 Jan',
        years: [1985, 2021] }), unavailable: {} }} />);
    const cyclone = screen.getByRole('article', { name: 'Tropical cyclone' });
    expect(within(cyclone).getByText('0.3%')).toBeInTheDocument();
    expect(within(cyclone).getByText(/a tropical storm or stronger passing within 100 km in the next 7 days/)).toBeInTheDocument();
    expect(within(cyclone).getByText('About 0.33 a year · most likely around 20 Aug')).toBeInTheDocument();
    expect(within(cyclone).getByText(/NOAA IBTrACS storm tracks, 1980–2026/)).toBeInTheDocument();
    const flood = screen.getByRole('article', { name: 'Large flood' });
    expect(within(flood).getByText('0.6%')).toBeInTheDocument();
    expect(within(flood).getByText('About 0.6 weeks a year · most likely around 29 Jan')).toBeInTheDocument();
    expect(within(flood).getByText(/1985–2021\. Tends to run about 20% high\./)).toBeInTheDocument();
    expect(screen.getByText(/Past records, not a forecast/)).toBeInTheDocument();
  });

  it('draws the season by month, highlights the current month and describes it for screen readers', () => {
    const { container } = render(<HazardOutlook now={NOV} outlook={{ cyclone: climate(), flood: null, unavailable: {} }} />);
    expect(screen.getByRole('img', { name: 'Chance in a typical week, by month: highest in Aug (2.8%)' })).toBeInTheDocument();
    const months = container.querySelectorAll('.hz-month');
    expect(months).toHaveLength(12);
    expect(months[10]).toHaveClass('is-now');
    expect(months[10]).toHaveAttribute('title', 'Nov: 0.3% in a typical week');
    expect((months[7].querySelector('.hz-bar span') as HTMLElement).style.height).toBe('100%');
    expect((months[0].querySelector('.hz-bar span') as HTMLElement).style.height).toBe('0%');
  });

  it('explains a missing figure instead of showing zero', () => {
    render(<HazardOutlook now={NOV} outlook={{ cyclone: null, flood: climate(),
      unavailable: { cyclone: "outside the cyclone climatology's area (45° S – 45° N, land and coast)" } }} />);
    const cyclone = screen.getByRole('article', { name: 'Tropical cyclone' });
    expect(within(cyclone).getByText(/Outside the area this model covers \(45° S – 45° N\)/)).toBeInTheDocument();
    expect(within(cyclone).queryByText(/%/)).not.toBeInTheDocument();
  });

  it('says when a quiet place has no season to draw, and describes a journey by its length', () => {
    render(<HazardOutlook now={NOV} outlook={{ cyclone: climate({ p_period: 0.0004, monthly_p_week: Array(12).fill(0.0001),
      scope: 'journey', period_days: 10, annual_rate: 0.01 }), flood: null, unavailable: {} }} />);
    expect(screen.getByRole('img', { name: 'Below 0.1% in a typical week of every month' })).toBeInTheDocument();
    expect(screen.getByText('<0.1%')).toBeInTheDocument();
    expect(screen.getByText(/during the trip \(10 days\)/)).toBeInTheDocument();
    expect(screen.getByText(/About less than 0\.05 a year/)).toBeInTheDocument();
  });

  it('counts flood weeks as expected weeks, not the occurrence rate, and keeps the rate for cyclones', () => {
    // every week at 0.5: expected weeks 0.5 × 52.18 ≈ 26.1, occurrence rate −ln(0.5) × 52.18 ≈ 36.2
    const half = { p_period: 0.5, p_week: 0.5, annual_rate: 36.17, expected_weeks_per_year: 26.09 };
    render(<HazardOutlook now={NOV} outlook={{ cyclone: climate(half), flood: climate(half), unavailable: {} }} />);
    expect(within(screen.getByRole('article', { name: 'Large flood' })).getByText(/^About 26\.1 weeks a year/)).toBeInTheDocument();
    expect(screen.queryByText(/36\.2 weeks/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'Tropical cyclone' })).getByText(/^About 36\.17 a year/)).toBeInTheDocument();
  });

  it('leaves out the weeks figure for floods when older data lack it', () => {
    render(<HazardOutlook now={NOV} outlook={{ cyclone: null, flood: climate({ annual_rate: 0.57 }), unavailable: {} }} />);
    const flood = screen.getByRole('article', { name: 'Large flood' });
    expect(within(flood).getByText('Most likely around 20 Aug')).toBeInTheDocument();
    expect(within(flood).queryByText(/weeks a year/)).not.toBeInTheDocument();
  });

  it('renders nothing without an outlook (older assessments: null or the property missing)', () => {
    expect(render(<HazardOutlook outlook={null} />).container).toBeEmptyDOMElement();
    expect(render(<HazardOutlook outlook={undefined} />).container).toBeEmptyDOMElement();
  });

  it('rounds like the risk service', () => {
    expect(formatChance(0.0004)).toBe('<0.1%');
    expect(formatChance(0.0634)).toBe('6.3%');
    expect(formatChance(0.279)).toBe('28%');
    expect(formatChance(0.995)).toBe('>99%');
    expect(formatChance(0)).toBe('0.0%');
  });
});
