import React from 'react';
import { Wallet, CreditCard, Gem, Check } from 'lucide-react';
import { BUDGET_LEVELS } from '../../utils/constants';
import type { BudgetLevel } from '../../types/trip';
import './BudgetSelector.css';

interface BudgetSelectorProps {
  value: BudgetLevel | '';
  onChange: (value: BudgetLevel) => void;
  error?: string;
}

const ICONS = { low: Wallet, medium: CreditCard, luxury: Gem } as const;

const BudgetSelector: React.FC<BudgetSelectorProps> = ({ value, onChange, error }) => (
  <div className="budget-selector">
    <div className="budget-options" role="radiogroup" aria-label="Budget level">
      {BUDGET_LEVELS.map((budget) => {
        const Glyph = ICONS[budget.value];
        const selected = value === budget.value;
        return (
          <label key={budget.value} className={`budget-option ${selected ? 'selected' : ''}`}>
            <input
              type="radio"
              name="budget"
              value={budget.value}
              checked={selected}
              onChange={(e) => onChange(e.target.value as BudgetLevel)}
              className="budget-radio"
            />
            <span className="budget-icon"><Glyph size={20} strokeWidth={1.75} /></span>
            <span className="budget-content">
              <span className="budget-label">{budget.label}</span>
              <span className="budget-description">{budget.description}</span>
            </span>
            <span className="budget-check" aria-hidden="true"><Check size={14} strokeWidth={2.5} /></span>
          </label>
        );
      })}
    </div>
    {error && <div className="error-message">{error}</div>}
  </div>
);

export default BudgetSelector;
