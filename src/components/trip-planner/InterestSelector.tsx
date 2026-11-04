import React from 'react';
import { TRAVEL_INTERESTS } from '../../utils/constants';
import { Icon } from '@/components/shared';
import type { Interest } from '../../types/trip';
import './InterestSelector.css';

interface InterestSelectorProps {
  value: Interest[];
  onChange: (interests: Interest[]) => void;
  error?: string;
}

const InterestSelector: React.FC<InterestSelectorProps> = ({ value, onChange, error }) => {
  const toggle = (interest: Interest) =>
    onChange(value.includes(interest) ? value.filter(i => i !== interest) : [...value, interest]);

  return (
    <div className="interest-selector">
      <div className="interest-grid" role="group" aria-label="Travel interests">
        {TRAVEL_INTERESTS.map((interest) => {
          const selected = value.includes(interest.value);
          return (
            <label key={interest.value} className={`interest-option ${selected ? 'selected' : ''}`}>
              <input
                type="checkbox"
                checked={selected}
                onChange={() => toggle(interest.value)}
                className="interest-checkbox"
              />
              <Icon name={interest.iconName} size="sm" className="interest-icon" />
              <span className="interest-label">{interest.label}</span>
            </label>
          );
        })}
      </div>
      {error && <div className="error-message">{error}</div>}
    </div>
  );
};

export default InterestSelector;
