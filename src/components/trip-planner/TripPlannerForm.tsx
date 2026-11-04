import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RotateCcw, AlertCircle, Minus, Plus, CalendarDays, Wallet, Users, MapPin } from 'lucide-react';
import Photo from '../ui/Photo';
import { getDestination } from '@/data/destinations';
import { saveJourney } from '@/services/journeySync';
import DestinationDropdown from './DestinationDropdown';
import BudgetSelector from './BudgetSelector';
import DateRangePicker from './DateRangePicker';
import InterestSelector from './InterestSelector';
import ComprehensiveLoader, { LOADING_STAGES as COMPREHENSIVE_LOADING_STAGES } from '../shared/ComprehensiveLoader';
import { useStageLoading } from '../../hooks/useLoadingStates';
import { useAsyncPerformance } from '../../hooks/usePerformance';
import type { TripPlannerFormData, BudgetLevel, Interest } from '../../types/trip';
import { VALIDATION_RULES, SAMPLE_DESTINATIONS } from '../../utils/constants';
import { itineraryService } from '../../services/itineraryService';
import './TripPlannerForm.css';

interface FormErrors {
  destination?: string;
  budget?: string;
  startDate?: string;
  endDate?: string;
  interests?: string;
  submit?: string;
}

interface FormState {
  destination: string;
  budget: BudgetLevel | '';
  startDate: Date | null;
  endDate: Date | null;
  interests: Interest[];
}

const LOADING_STAGES = [
  'Validating your preferences...',
  'Connecting to the itinerary service...',
  'Analyzing destinations and activities...',
  'Creating your personalized itinerary...',
  'Finalizing recommendations...'
];

const TripPlannerForm: React.FC = () => {
  const navigate = useNavigate();
  const [errors, setErrors] = useState<FormErrors>({});
  const [travelers, setTravelers] = useState(2);
  const { measureAsync } = useAsyncPerformance();
  
  const {
    isLoading,
    error: loadingError,
    progress,
    startLoading,
    nextStage,
    finishLoading,
    setError: setLoadingError,
  } = useStageLoading(LOADING_STAGES);
  
  const [searchParams] = useSearchParams();

  const [formData, setFormData] = useState<FormState>(() => {
    const destParam = searchParams.get('destination') || '';
    let initialDest = '';
    if (destParam) {
      const match = SAMPLE_DESTINATIONS.find(
        d => d.id.toLowerCase() === destParam.toLowerCase() ||
             d.name.toLowerCase().includes(destParam.toLowerCase())
      );
      if (match) initialDest = match.id;
    }
    return {
      destination: initialDest,
      budget: '',
      startDate: null,
      endDate: null,
      interests: []
    };
  });

  useEffect(() => {
    const destParam = searchParams.get('destination');
    if (destParam) {
      const match = SAMPLE_DESTINATIONS.find(
        d => d.id.toLowerCase() === destParam.toLowerCase() ||
             d.name.toLowerCase().includes(destParam.toLowerCase())
      );
      if (match) {
        setFormData(prev => ({ ...prev, destination: match.id }));
      }
    }
  }, [searchParams]);

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    // Validate destination
    if (!formData.destination) {
      newErrors.destination = 'Please select a destination';
    }

    // Validate budget
    if (!formData.budget) {
      newErrors.budget = 'Please select a budget level';
    }

    // Validate start date
    if (!formData.startDate) {
      newErrors.startDate = 'Please select a departure date';
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (formData.startDate < today) {
        newErrors.startDate = 'Departure date cannot be in the past';
      }
    }

    // Validate end date
    if (!formData.endDate) {
      newErrors.endDate = 'Please select a return date';
    } else if (formData.startDate && formData.endDate <= formData.startDate) {
      newErrors.endDate = 'Return date must be after departure date';
    } else if (formData.startDate) {
      const tripDuration = Math.ceil(
        (formData.endDate.getTime() - formData.startDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (tripDuration < VALIDATION_RULES.MIN_TRIP_DURATION) {
        newErrors.endDate = `Trip must be at least ${VALIDATION_RULES.MIN_TRIP_DURATION} day(s)`;
      } else if (tripDuration > VALIDATION_RULES.MAX_TRIP_DURATION) {
        newErrors.endDate = `Trip cannot exceed ${VALIDATION_RULES.MAX_TRIP_DURATION} days`;
      }
    }

    // Validate interests
    if (!formData.interests || formData.interests.length === 0) {
      newErrors.interests = 'Please select at least one interest';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    startLoading();
    setErrors({}); // Clear any previous errors
    
    try {
      // Create complete form data
      const completeFormData: TripPlannerFormData = {
        destination: formData.destination,
        budget: formData.budget as BudgetLevel,
        startDate: formData.startDate!,
        endDate: formData.endDate!,
        interests: formData.interests
      };

      // Stage 1: Validation complete
      await new Promise(resolve => setTimeout(resolve, 200));
      nextStage();

      // Stage 2: Connecting to API
      await new Promise(resolve => setTimeout(resolve, 150));
      nextStage();

      // Stage 3: Analyzing preferences
      await new Promise(resolve => setTimeout(resolve, 200));
      nextStage();

      // Stage 4: Generate itinerary with performance monitoring
      const response = await measureAsync(
        () => itineraryService.generateItinerary(completeFormData),
        'generateItinerary'
      );
      nextStage();

      // Stage 5: Finalizing
      await new Promise(resolve => setTimeout(resolve, 150));
      
      if (response.success && response.data) {
        // Store both form data and generated itinerary for the next page
        sessionStorage.setItem('tripPlannerData', JSON.stringify(completeFormData));
        // Keep the planner context with the itinerary so trip cards can show destination, dates and travellers
        const stored = {
          ...response.data,
          destination: completeFormData.destination,
          startDate: completeFormData.startDate,
          endDate: completeFormData.endDate,
          budget: completeFormData.budget,
          interests: completeFormData.interests,
          travelers,
        };
        // Persist to the account when signed in; the local copy is kept either way (offline cache)
        let journeyId: string | null = null;
        try {
          journeyId = await saveJourney(stored);
        } catch (err) {
          console.warn('Journey not saved to server; kept on this device', err);
        }
        const local = journeyId ? { ...stored, journeyId } : stored;
        sessionStorage.setItem('generatedItinerary', JSON.stringify(local));
        localStorage.setItem('currentTrip', JSON.stringify(local));
        
        finishLoading();
        
        // Navigate to itinerary page with the trip ID
        navigate(`/itinerary/${journeyId || response.data.tripId}`);
      } else {
        throw new Error('Failed to generate itinerary');
      }
      
    } catch (error) {
      console.error('Error submitting form:', error);
      setLoadingError('Failed to generate your itinerary. Please check your connection and try again.');
      setErrors({
        submit: 'Failed to generate your itinerary. Please check your connection and try again.'
      });
    }
  };

  const handleReset = () => {
    setFormData({
      destination: '',
      budget: '',
      startDate: null,
      endDate: null,
      interests: []
    });
    setTravelers(2);
    setErrors({});
  };

  const handleRetry = () => {
    setLoadingError(null);
    handleSubmit(new Event('submit') as any);
  };

  const dest = getDestination(formData.destination);
  const nights = formData.startDate && formData.endDate
    ? Math.max(0, Math.round((formData.endDate.getTime() - formData.startDate.getTime()) / 86400000))
    : 0;
  const estimate = dest && formData.budget && nights
    ? dest.averageCost[formData.budget as BudgetLevel] * nights * travelers
    : null;
  const fmt = (d: Date | null) => (d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—');

  const steps = [
    { n: 1, done: !!formData.destination },
    { n: 2, done: !!(formData.startDate && formData.endDate) },
    { n: 3, done: !!formData.budget },
    { n: 4, done: formData.interests.length > 0 },
  ];

  return (
    <div className="trip-planner-form">
      {isLoading && (
        <ComprehensiveLoader
          isLoading={isLoading}
          stages={[...COMPREHENSIVE_LOADING_STAGES.ITINERARY_GENERATION]}
          progress={progress}
          error={loadingError || undefined}
          onRetry={handleRetry}
          overlay={true}
          size="lg"
          showProgress={true}
          showStageIndicators={true}
          theme="travel"
        />
      )}

      <form onSubmit={handleSubmit} className="planner-layout" noValidate>
        <div className="surface planner-card form-container">
          {errors.submit && (
            <div className="notice notice-danger" role="alert">
              <AlertCircle size={18} />
              <span>{errors.submit}</span>
            </div>
          )}

          <section className="planner-step" aria-labelledby="step-1">
            <h2 className="planner-step-title" id="step-1">
              <span className={`planner-step-num ${steps[0].done ? 'is-done' : ''}`}>1</span> Destination
            </h2>
            <DestinationDropdown
              value={formData.destination}
              onChange={(value) => setFormData(prev => ({ ...prev, destination: value }))}
              error={errors.destination}
            />
            <div className="quick-destinations-row">
              <span className="quick-label">Popular</span>
              {['paris', 'kyoto', 'bali', 'santorini', 'new-york', 'iceland'].map(destId => {
                const d = SAMPLE_DESTINATIONS.find(x => x.id === destId);
                if (!d) return null;
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={`chip ${formData.destination === d.id ? 'is-active' : ''}`}
                    onClick={() => setFormData(prev => ({ ...prev, destination: d.id }))}
                  >
                    {d.name.split(',')[0]}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="planner-step" aria-labelledby="step-2">
            <h2 className="planner-step-title" id="step-2">
              <span className={`planner-step-num ${steps[1].done ? 'is-done' : ''}`}>2</span> Dates &amp; travellers
            </h2>
            <DateRangePicker
              startDate={formData.startDate}
              endDate={formData.endDate}
              onStartDateChange={(date) => setFormData(prev => ({ ...prev, startDate: date }))}
              onEndDateChange={(date) => setFormData(prev => ({ ...prev, endDate: date }))}
              startDateError={errors.startDate}
              endDateError={errors.endDate}
            />
            <div className="travellers-row">
              <span className="travellers-label"><Users size={16} /> Travellers</span>
              <div className="stepper" role="group" aria-label="Number of travellers">
                <button type="button" className="icon-btn is-outlined" onClick={() => setTravelers(t => Math.max(1, t - 1))} disabled={travelers <= 1} aria-label="Fewer travellers"><Minus size={16} /></button>
                <span className="stepper-value" aria-live="polite">{travelers}</span>
                <button type="button" className="icon-btn is-outlined" onClick={() => setTravelers(t => Math.min(9, t + 1))} disabled={travelers >= 9} aria-label="More travellers"><Plus size={16} /></button>
              </div>
            </div>
          </section>

          <section className="planner-step" aria-labelledby="step-3">
            <h2 className="planner-step-title" id="step-3">
              <span className={`planner-step-num ${steps[2].done ? 'is-done' : ''}`}>3</span> Budget
            </h2>
            <BudgetSelector
              value={formData.budget}
              onChange={(value) => setFormData(prev => ({ ...prev, budget: value }))}
              error={errors.budget}
            />
          </section>

          <section className="planner-step" aria-labelledby="step-4">
            <h2 className="planner-step-title" id="step-4">
              <span className={`planner-step-num ${steps[3].done ? 'is-done' : ''}`}>4</span> Interests
              <span className="planner-step-hint">Pick any</span>
            </h2>
            <InterestSelector
              value={formData.interests}
              onChange={(interests) => setFormData(prev => ({ ...prev, interests }))}
              error={errors.interests}
            />
          </section>
        </div>

        <aside className="planner-summary" aria-label="Trip summary">
          <div className="surface planner-summary-card">
            {dest ? (
              <Photo
                key={dest.id}
                src={dest.imageUrl}
                alt={dest.imageCaption ? `${dest.imageCaption}, ${dest.city}` : dest.name}
                width={340}
                ratio="4 / 3"
                caption={dest.imageCaption}
                priority
              />
            ) : (
              <div className="planner-summary-empty">
                <MapPin size={22} strokeWidth={1.6} />
                <span>Choose a destination to preview it here</span>
              </div>
            )}
            <div className="planner-summary-body">
              <p className="eyebrow">Your trip</p>
              <h3 className="planner-summary-title">{dest ? dest.city : 'Somewhere new'}</h3>
              {dest && <p className="text-muted">{dest.country}</p>}

              <dl className="planner-summary-list">
                <div><dt><CalendarDays size={16} /> Dates</dt><dd>{formData.startDate ? `${fmt(formData.startDate)} – ${fmt(formData.endDate)}` : '—'}</dd></div>
                <div><dt><Users size={16} /> Travellers</dt><dd>{travelers}</dd></div>
                <div><dt><Wallet size={16} /> Estimate</dt><dd>{estimate ? `≈ $${estimate.toLocaleString()}` : '—'}</dd></div>
              </dl>
              {estimate !== null && (
                <p className="planner-summary-note">Daily spend × {nights} nights × {travelers} travellers, excluding flights.</p>
              )}

              <div className="planner-progress" aria-label={`${steps.filter(st => st.done).length} of 4 steps complete`}>
                {steps.map(st => <span key={st.n} className={st.done ? 'is-done' : ''} />)}
              </div>

              <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={isLoading}>
                {isLoading ? <><span className="spinner" /> Building itinerary…</> : <>Create my itinerary</>}
              </button>
              <button type="button" onClick={handleReset} className="btn btn-ghost btn-block" disabled={isLoading}>
                <RotateCcw size={16} /> Reset
              </button>
            </div>
          </div>
        </aside>
      </form>
    </div>
  );
};

export default TripPlannerForm;