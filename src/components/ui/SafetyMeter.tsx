import React from 'react';
import { LEVEL_LABEL, type ConditionsState, type PlaceConditions } from '@/services/conditions';

interface SafetyMeterProps {
  placeId: string;
  conditions: ConditionsState;
  onOpen?: () => void;
}

const SEGMENTS = ['LOW', 'MODERATE', 'HIGH'] as const;

/** Compact 8-factor safety meter: risk level + how many factors are backed by real data. */
const SafetyMeter: React.FC<SafetyMeterProps> = ({ placeId, conditions, onOpen }) => {
  let c: PlaceConditions | undefined;
  let label: string;
  let sub: string;
  let tone = 'none';

  if (conditions.state === 'signed-out') {
    label = 'Live safety';
    sub = 'Sign in to see';
  } else if (conditions.state === 'loading') {
    label = 'Checking…';
    sub = 'Live conditions';
    tone = 'loading';
  } else if (conditions.state === 'error') {
    label = 'Unavailable';
    sub = 'Server not reachable';
  } else {
    c = conditions.byPlace[placeId];
    if (!c || !c.risk_level) {
      label = 'Unavailable';
      sub = 'No live conditions';
    } else {
      label = LEVEL_LABEL[c.risk_level];
      tone = c.risk_level.toLowerCase();
      sub = c.data_status === 'STALE' ? 'Data may be outdated' : c.weather?.summary || '';
    }
  }

  const level = c?.risk_level;
  const filled = level ? SEGMENTS.indexOf(level === 'CRITICAL' ? 'HIGH' : level) + 1 : 0;
  const Tag = onOpen ? 'button' : 'div';

  return (
    <Tag
      type={onOpen ? 'button' : undefined}
      className={`safety-meter tone-${tone}`}
      onClick={onOpen}
      title={c?.headline}
      aria-label={`Safety: ${label}${c ? `. ${c.factors_available} of 8 factors backed by live or configured data.` : ''}`}
    >
      <span className="safety-meter-top">
        <span className="safety-meter-label">{label}</span>
        {c && <span className="safety-meter-conf">{c.factors_available}/8 data</span>}
      </span>
      <span className="safety-meter-bar" aria-hidden="true">
        {SEGMENTS.map((s, i) => <span key={s} className={i < filled ? 'is-on' : ''} />)}
      </span>
      <span className="safety-meter-sub">{sub}</span>
    </Tag>
  );
};

export default SafetyMeter;
