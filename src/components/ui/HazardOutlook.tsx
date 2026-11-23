// Seasonal hazard cards: how often tropical cyclones and large floods have reached a place, by time of year.
// Historical frequency from long event records (risk-service docs/ML.md) — not a forecast, and not a chance of harm.
import React from 'react';
import { Tornado, Waves } from 'lucide-react';
import type { HazardClimate, HazardOutlook as Outlook } from '@/services/conditions';
import './HazardOutlook.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Same rounding as the risk service's explanations. */
export function formatChance(p: number): string {
  if (p > 0.99) return '>99%';
  if (p > 0 && p < 0.001) return '<0.1%';
  return p < 0.1 ? `${(p * 100).toFixed(1)}%` : `${Math.round(p * 100)}%`;
}

const HAZARDS = {
  cyclone: {
    title: 'Tropical cyclone', Icon: Tornado,
    // occurrences per year (Poisson rate)
    rate: (d: HazardClimate) => `About ${d.annual_rate < 0.05 ? 'less than 0.05' : d.annual_rate.toFixed(2)} a year`,
    event: 'a tropical storm or stronger passing within 100 km',
    source: 'NOAA IBTrACS storm tracks',
    caveat: null as string | null,
    outside: 'Outside the area this model covers (45° S – 45° N). Tropical cyclones rarely reach here.',
  },
  flood: {
    title: 'Large flood', Icon: Waves,
    // expected affected weeks (sum of weekly chances), not the Poisson rate; omitted when older data lack it
    rate: (d: HazardClimate) => d.expected_weeks_per_year === undefined ? null
      : `About ${d.expected_weeks_per_year < 0.05 ? 'less than 0.05' : d.expected_weeks_per_year.toFixed(1)} weeks a year`,
    event: 'a large flood affecting the area within 100 km',
    source: 'Dartmouth Flood Observatory records',
    caveat: 'Tends to run about 20% high.',
    outside: 'Outside the area this model covers (land between 56° S and 72° N).',
  },
} as const;

type Key = keyof typeof HAZARDS;

const reasonText = (key: Key, reason: string) =>
  reason.startsWith('outside') ? HAZARDS[key].outside : 'Not available on this server right now.';

const MonthStrip: React.FC<{ values: number[]; current: number }> = ({ values, current }) => {
  const max = Math.max(...values, 1e-9);
  const peak = values.indexOf(Math.max(...values));
  const label = max < 0.001
    ? 'Below 0.1% in a typical week of every month'
    : `Chance in a typical week, by month: highest in ${MONTHS[peak]} (${formatChance(values[peak])})`;
  return (
    <div className="hz-months" role="img" aria-label={label}>
      {values.map((v, i) => (
        <div key={MONTHS[i]} className={`hz-month${i === current ? ' is-now' : ''}`} title={`${MONTHS[i]}: ${formatChance(v)} in a typical week`}>
          <span className="hz-bar"><span style={{ height: `${max < 0.001 ? 0 : Math.max(v > 0 ? 4 : 0, (v / max) * 100)}%` }} /></span>
          <span className="hz-month-label" aria-hidden="true">{MONTHS[i][0]}</span>
        </div>
      ))}
    </div>
  );
};

const HazardCard: React.FC<{ hazardKey: Key; data: HazardClimate | null; reason?: string; month: number }> = ({ hazardKey, data, reason, month }) => {
  const h = HAZARDS[hazardKey];
  return (
    <article className={`hz-card${data ? '' : ' is-empty'}`} aria-labelledby={`hz-${hazardKey}`}>
      <header className="hz-head">
        <span className="hz-icon" aria-hidden="true"><h.Icon size={18} /></span>
        <h3 id={`hz-${hazardKey}`}>{h.title}</h3>
      </header>
      {data ? (
        <>
          <p className="hz-figure">{formatChance(data.p_period)}</p>
          <p className="hz-figure-label">
            chance of {h.event} {data.scope === 'journey' ? `during the trip (${Math.round(data.period_days)} days)` : 'in the next 7 days'}
          </p>
          <p className="hz-rate">
            {[h.rate(data), `${h.rate(data) ? 'most' : 'Most'} likely around ${data.peak_week_start}`].filter(Boolean).join(' · ')}
          </p>
          <MonthStrip values={data.monthly_p_week} current={month} />
          <p className="hz-source">
            From {h.source}, {data.years[0]}–{data.years[1]}.{h.caveat ? ` ${h.caveat}` : ''}
          </p>
        </>
      ) : (
        <p className="hz-reason">{reasonText(hazardKey, reason ?? '')}</p>
      )}
    </article>
  );
};

const HazardOutlook: React.FC<{ outlook: Outlook | null | undefined; now?: Date }> = ({ outlook, now = new Date() }) => {
  if (!outlook) return null;
  const keys = (Object.keys(HAZARDS) as Key[]).filter(k => outlook[k] || outlook.unavailable[k]);
  if (!keys.length) return null;
  return (
    <section className="hz" aria-labelledby="hz-title">
      <div className="hz-intro">
        <h3 className="hz-title" id="hz-title">Seasonal hazards</h3>
        <p className="hz-sub">How often these have reached the area at each time of year. Past records, not a forecast — follow official warnings for storms already on the way.</p>
      </div>
      <div className="hz-grid">
        {keys.map(k => <HazardCard key={k} hazardKey={k} data={outlook[k]} reason={outlook.unavailable[k]} month={now.getMonth()} />)}
      </div>
    </section>
  );
};

export default HazardOutlook;
