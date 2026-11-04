import React from 'react';
import { PlaneTakeoff, PlaneLanding, Moon } from 'lucide-react';
import { dateUtils } from '../../utils/dateUtils';
import './DateRangePicker.css';

interface DateRangePickerProps {
  startDate: Date | null;
  endDate: Date | null;
  onStartDateChange: (date: Date | null) => void;
  onEndDateChange: (date: Date | null) => void;
  startDateError?: string;
  endDateError?: string;
}

const DateRangePicker: React.FC<DateRangePickerProps> = ({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  startDateError,
  endDateError,
}) => {
  const todayDate = new Date();
  const today = dateUtils.formatDateForInput(todayDate);
  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + 2);
  const maxDateString = dateUtils.formatDateForInput(maxDate);

  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const date = e.target.value ? dateUtils.parseInputDate(e.target.value) : null;
    onStartDateChange(date);
    if (date && endDate && date >= endDate) onEndDateChange(null);
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onEndDateChange(e.target.value ? dateUtils.parseInputDate(e.target.value) : null);
  };

  const getMinEndDate = () => {
    if (!startDate) return today;
    const minDate = new Date(startDate);
    minDate.setDate(minDate.getDate() + 1);
    return dateUtils.formatDateForInput(minDate);
  };

  const nights = startDate && endDate
    ? Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  return (
    <div className="date-range-picker">
      <div className="date-inputs">
        <div className="date-input-group">
          <label htmlFor="start-date" className="date-label">
            <PlaneTakeoff size={16} /> Departure
          </label>
          <input
            id="start-date"
            type="date"
            value={startDate ? dateUtils.formatDateForInput(startDate) : ''}
            onChange={handleStartDateChange}
            min={today}
            max={maxDateString}
            className={`input date-input ${startDateError ? 'error' : ''}`}
            aria-invalid={!!startDateError}
          />
          {startDateError && <div className="error-message">{startDateError}</div>}
        </div>

        <div className="date-input-group">
          <label htmlFor="end-date" className="date-label">
            <PlaneLanding size={16} /> Return
          </label>
          <input
            id="end-date"
            type="date"
            value={endDate ? dateUtils.formatDateForInput(endDate) : ''}
            onChange={handleEndDateChange}
            min={getMinEndDate()}
            max={maxDateString}
            className={`input date-input ${endDateError ? 'error' : ''}`}
            disabled={!startDate}
            aria-invalid={!!endDateError}
          />
          {endDateError && <div className="error-message">{endDateError}</div>}
        </div>
      </div>

      {nights > 0 && (
        <div className="trip-duration">
          <Moon size={14} />
          <span className="duration-text">{nights} night{nights === 1 ? '' : 's'} · {nights + 1} days</span>
        </div>
      )}
    </div>
  );
};

export default DateRangePicker;
