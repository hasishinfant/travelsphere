import React from 'react';

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: React.ReactNode; icon?: React.ReactNode }>;
  ariaLabel: string;
  className?: string;
}

/** Pill segmented control — "Upcoming | Recent" style tabs. */
function Segmented<T extends string>({ value, onChange, options, ariaLabel, className = '' }: SegmentedProps<T>) {
  return (
    <div className={`segmented ${className}`} role="tablist" aria-label={ariaLabel}>
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          className={`segmented-item ${value === opt.value ? 'is-active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.icon}
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

export default Segmented;
